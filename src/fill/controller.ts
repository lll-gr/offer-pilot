/**
 * 填充编排入口：深度扫描 → 观察 → 规划（缓存/AI 决策 + 本地防线）→ 执行（或分块多步）。
 * content script 的消息入口，也是唯一持有运行时统计状态的地方；
 * 规划编排在 plan/build.ts，执行循环在 execute/pipeline.ts，分块流程在 segmented-flow.ts。
 */

import { CONTENT_SCRIPT_VERSION } from '@/messaging/bridge'
import type { FillFieldReport, StartFillResponse } from '@/messaging/bridge'
import type { FieldProgressEvent, FillEvent, PhaseEvent } from '@/messaging/events'
import { formatFieldSummary, formatMappingSummary } from '@/logs/diagnostics'
import { normalizeResumeProfile } from '@/resume/schema'
import { loadSettings } from '@/settings/storage'
import { triggerExpandableSections } from './deep-scan'
import { clearFieldHighlights, scheduleHighlightAutoClear, showFieldHighlights } from './highlight'
import { observeFields } from './observe'
import {
  applyDecisionCorrection,
  createFieldKey,
  createMappingCacheKeyFromSignature,
  createMappingCacheSignature,
  loadMappingCacheEntry,
  saveMappingCacheEntry,
} from './plan/cache'
import { buildFillPlan } from './plan/build'
import { applyDecisionRules } from './plan/rules'
import { executePlan } from './execute/pipeline'
import type { SendLog, SendStats } from './execute/pipeline'
import { requestSelectionRect } from './selection'
import { scanFields } from './scanner/fields'
import type { SelectionRect } from './scanner/fields'
import { runSegmentedFill } from './segmented-flow'
import type { FieldDecision, FieldObservation, FieldOutcome, FieldRuntime, FillMode, FillScope } from './types'

/**
 * 填充会话状态（模块唯一可变状态，替代散变量）：
 * 统计 + 进行中标志 + 取消器 + 决策纠错现场。
 */
interface FillSessionState {
  fieldCount: number
  mappedCount: number
  filledCount: number
  isWorking: boolean
  abort: AbortController | null
  plan: {
    fields: Array<{ fieldId: string; label: string }>
    decisions: FieldDecision[]
    /** fieldId → 字段指纹（写回缓存对齐用，替代保存全量 descriptor） */
    fieldKeys: Map<string, string>
    /** 缓存重算原料（fields 签名），仅在纠错时用于重建 cache key */
    cacheSignature: ReturnType<typeof createMappingCacheSignature>
    /** 纠错预览：fieldId → 本地防线求值所需的最小观察快照 */
    observationSnapshots: Map<string, FieldObservation>
  } | null
}

const session: FillSessionState = {
  fieldCount: 0,
  mappedCount: 0,
  filledCount: 0,
  isWorking: false,
  abort: null,
  plan: null,
}

/**
 * 侧栏拉取最近一次填充的决策结果（瘦身载荷：label only；mappings 键名保持消息协议兼容）。
 * 返回的 decisions 已是本地防线（refinePlan）后的实际生效版本——UI 只展示不计算。
 */
export function getLastMappings(): {
  fields: Array<{ fieldId: string; label: string }>
  mappings: FieldDecision[]
} | null {
  if (!session.plan) return null
  return { fields: session.plan.fields, mappings: session.plan.decisions }
}

/**
 * 修正一条决策（侧栏「映射纠错」）：同时写回当前缓存条目（按字段指纹对齐），
 * 下次同结构表单命中缓存即为修正后的决策（含动作）。
 * action 缺省时按「有映射=fill、无映射=skip」推断（兼容旧 UI 只改路径的用法）。
 */
export async function correctMapping(
  fieldId: string,
  resumePath: string,
  action?: FieldDecision['action']
): Promise<{ success: boolean; message?: string; decision?: FieldDecision }> {
  if (!session.plan) {
    return { success: false, message: '没有可修正的映射记录，请先执行一次填充' }
  }

  const decision = session.plan.decisions.find((item) => item.fieldId === fieldId)
  if (!decision) {
    return { success: false, message: `映射记录中不存在字段 ${fieldId}` }
  }

  const fieldKey = session.plan.fieldKeys.get(fieldId)
  if (!fieldKey) {
    return { success: false, message: '该字段缺少指纹，无法持久化修正（请重新发起一次填充后重试）' }
  }

  const nextAction = action ?? (resumePath ? 'fill' : 'skip')
  decision.resumePath = resumePath
  decision.reason = '用户手动修正'
  decision.action = nextAction
  decision.fieldKey = fieldKey

  // 用户修正后再过一遍本地防线（与真实填充同一条代码路径），
  // 会话内即时生效降级（如敏感字段强制 manual），并把实际生效决策回传 UI 展示
  const snapshot = session.plan.observationSnapshots.get(fieldId)
  const effective = snapshot ? applyDecisionRules(decision, snapshot) : { ...decision }
  decision.action = effective.action
  decision.reason = effective.reason

  // 写回缓存条目：按指纹更新对应条目（若最近一次为缓存命中）
  try {
    const cacheSignature = session.plan.cacheSignature
    const cacheKey = createMappingCacheKeyFromSignature(cacheSignature, {
      origin: location.origin,
      pathname: location.pathname,
      host: location.host,
    })
    const cacheLookup = await loadMappingCacheEntry(cacheKey, {
      host: location.host,
      path: location.pathname,
      signature: cacheSignature,
    })
    if (cacheLookup.entry) {
      const correctedEntry = applyDecisionCorrection(cacheLookup.entry, {
        fieldKey,
        fieldId,
        resumePath,
        action: decision.action,
      })
      await saveMappingCacheEntry(cacheKey, correctedEntry)
    }
  } catch {
    // 缓存写回失败不影响会话内修正结果
  }

  return { success: true, decision: { ...decision } }
}

/** 用户请求中止当前填充（来自侧栏「停止」按钮） */
export function requestCancelFill(): boolean {
  if (!session.isWorking || !session.abort) return false
  session.abort.abort()
  return true
}

/**
 * content script 的事件出口（由 entrypoints/content.ts 注入）。
 * 单一 emit：所有通知（log/stats/phase/fieldProgress）都从这里走 FillEvent 契约。
 */
export interface FillControllerPort {
  emit: (event: FillEvent) => void
}

/** 默认出口：单发 chrome 消息（侧栏开着就渲染，关着就丢弃——进度事件本就易逝） */
function emitViaRuntime(event: FillEvent): void {
  chrome.runtime.sendMessage(event).catch(() => {})
}

export function getStatus(): { fieldCount: number; mappedCount: number; filledCount: number } {
  return { fieldCount: session.fieldCount, mappedCount: session.mappedCount, filledCount: session.filledCount }
}

export function getPingInfo(): { version: string; capabilities: { fullDiagnostics: boolean } } {
  return { version: CONTENT_SCRIPT_VERSION, capabilities: { fullDiagnostics: true } }
}

export async function handleStartFill(
  modelId: string,
  resumeProfile: Record<string, unknown>,
  request: { fillMode?: string; scope?: string } = {},
  port: FillControllerPort = { emit: emitViaRuntime }
): Promise<StartFillResponse> {
  if (session.isWorking) {
    return { success: false, message: '正在执行中，请稍后再试' }
  }

  session.isWorking = true
  clearFieldHighlights()

  const abort = new AbortController()
  session.abort = abort
  let canceled = false

  try {
    abort.signal.addEventListener('abort', () => {
      canceled = true
    })
    if (!resumeProfile || typeof resumeProfile !== 'object') {
      throw new Error('标准简历为空：请先在侧边栏填写或导入标准简历')
    }

    // 填充时重归一化（幂等）：保证 age/isFreshGraduate 等派生值在现场计算，
    // 不依赖侧栏加载时机（LLM 只映射 personal.age，计算在代码里完成）
    resumeProfile = normalizeResumeProfile(resumeProfile)

    // 应用设置本次会话快照：填充中途改设置不影响进行中的填充（行为可预期）
    const settings = await loadSettings()

    const fillMode: FillMode =
      request?.fillMode === 'incremental' ? 'incremental' : request?.fillMode === 'segmented' ? 'segmented' : 'overwrite'
    const scope: FillScope = request?.scope === 'selection' ? 'selection' : 'page'
    let selectionRect: SelectionRect | null = null

    const emit = port.emit
    const sendLog: SendLog = (level, text) => emit({ type: 'log', level, text })
    const sendPhase = (phase: PhaseEvent) => emit(phase)
    const sendFieldProgress = (event: FieldProgressEvent) => emit(event)
    const sendStats: SendStats = (fieldCount, mappedCount, filledCount) => {
      session.fieldCount = fieldCount
      session.mappedCount = mappedCount
      session.filledCount = filledCount
      emit({ type: 'stats', fieldCount, mappedCount, filledCount })
    }

    if (scope === 'selection') {
      sendPhase({ type: 'phase', phase: 'selection' })
      sendLog('info', '已进入选区模式：请在页面上拖拽框选要填写的区域。')
      selectionRect = await requestSelectionRect()
      if (!selectionRect) {
        return { success: false, canceled: true, message: '已取消选区填入' }
      }
      sendLog(
        'info',
        `选区已确认：left=${Math.round(selectionRect.left)} top=${Math.round(selectionRect.top)} width=${Math.round(
          selectionRect.width,
        )} height=${Math.round(selectionRect.height)}`,
      )
    }

    if (scope === 'page') {
      sendPhase({ type: 'phase', phase: 'expanding' })
      sendLog('info', '正在探索页面上的可展开区块...')
      await triggerExpandableSections(resumeProfile, (message) => sendLog('info', message), {
        maxRounds: settings.deepScanMaxRounds,
      })
    }

    sendPhase({ type: 'phase', phase: 'scanning' })
    sendLog('info', scope === 'selection' ? '开始扫描选区内表单字段...' : '开始扫描当前页面表单字段...')
    const scan = scanFields({ scope, selectionRect })

    sendStats(scan.fields.length, 0, 0)

    const fieldRuntimeMap = new Map<string, FieldRuntime>()
    for (const runtime of scan.runtime) {
      fieldRuntimeMap.set(runtime.fieldId, runtime)
    }

    for (const field of scan.fields) {
      sendLog('info', formatFieldSummary(field))
    }

    if (scan.fields.length === 0) {
      return {
        success: false,
        message:
          scope === 'selection'
            ? '选区内未识别到可填写字段，请重新框选后再试'
            : '未识别到可填写字段，请确认当前页面包含表单',
      }
    }

    // --- 观察：descriptor + 当前值快照 ---
    const observations = observeFields(scan.fields, fieldRuntimeMap)

    // --- 分块多步分支：每块独立规划/执行，无需整页规划（避免双倍 AI 调用） ---
    if (fillMode === 'segmented') {
      return await runSegmentedFill(scan, resumeProfile, modelId, {
        sendLog,
        sendStats,
        signal: abort.signal,
        onPhase: sendPhase,
        onFieldProgress: sendFieldProgress,
        maxRounds: settings.segmentMaxRounds,
        batchSize: settings.aiBatchSize,
        retryCount: settings.fillRetryCount,
        highlightAutoClearMs: settings.highlightAutoClearMs,
      })
    }

    // --- 规划：先查缓存，未命中调 AI（含五动作决策） ---
    const cacheSignature = createMappingCacheSignature(scan.fields)
    const { plan, cacheHit } = await buildFillPlan(observations, resumeProfile, modelId, {
      sendLog,
      signal: abort.signal,
      onPhase: sendPhase,
      batchSize: settings.aiBatchSize,
      cacheMaxEntries: settings.cacheMaxEntries,
    })
    session.plan = {
      fields: scan.fields.map((field) => ({ fieldId: field.fieldId, label: field.label || field.fieldId })),
      decisions: plan,
      fieldKeys: new Map(scan.fields.map((field) => [field.fieldId, createFieldKey(field)])),
      cacheSignature,
      observationSnapshots: new Map(
        observations.map((observation) => [observation.descriptor.fieldId, observation]),
      ),
    }

    const decisionMap = decisionsById(plan)
    for (const observation of observations) {
      const decision = decisionMap.get(observation.descriptor.fieldId) || {
        fieldId: observation.descriptor.fieldId,
        action: 'skip' as const,
        resumePath: '',
        reason: '未返回决策结果',
        transform: { type: 'none' as const },
      }
      sendLog(
        decision.resumePath || decision.action !== 'skip' ? 'info' : 'warning',
        formatMappingSummary(observation.descriptor, decision, { source: cacheHit ? 'cache' : 'ai' }),
      )
    }

    const mappedCount = plan.filter((decision) => Boolean(String(decision.resumePath || '').trim())).length

    sendStats(scan.fields.length, mappedCount, 0)
    sendLog(
      'info',
      fillMode === 'incremental' ? '开始根据填充计划执行增量填充...' : '开始根据填充计划执行本地填充...',
    )

    // --- 逐字段执行 ---
    sendPhase({ type: 'phase', phase: 'executing' })
    const outcome = await executePlan(observations, decisionMap, resumeProfile, {
      fillMode: fillMode === 'incremental' ? 'incremental' : 'overwrite',
      sendLog,
      signal: abort.signal,
      onFieldProgress: sendFieldProgress,
      retryCount: settings.fillRetryCount,
      onProgress: (filledCount) => sendStats(scan.fields.length, mappedCount, filledCount),
    })

    if (outcome.filledRuntimes.length > 0) {
      showFieldHighlights(outcome.filledRuntimes)
      scheduleHighlightAutoClear(settings.highlightAutoClearMs)
    }

    sendStats(scan.fields.length, mappedCount, outcome.filledCount)
    sendLog(
      canceled ? 'warning' : 'success',
      canceled
        ? `已停止：映射 ${mappedCount}/${scan.fields.length} 个字段，停止前已填充 ${outcome.filledCount} 个。`
        : `填充完成：映射 ${mappedCount}/${scan.fields.length} 个字段，成功填充 ${outcome.filledCount} 个。请检查后手动提交。`,
    )

    const manualCount = outcome.outcomes.filter((item) => item.outcome === 'manual').length
    const failedCount = outcome.outcomes.filter((item) => item.outcome === 'failed').length
    if (manualCount > 0 || failedCount > 0) {
      sendLog('warning', `有 ${manualCount} 个字段建议人工处理、${failedCount} 个字段填充失败，详见「填充报告」。`)
    }

    return {
      success: true,
      canceled,
      fieldCount: scan.fields.length,
      mappedCount,
      filledCount: outcome.filledCount,
      cacheHit,
      fieldReport: buildFieldReport(outcome.outcomes, observations),
    }
  } catch (error) {
    return { success: false, message: (error as Error)?.message || String(error) }
  } finally {
    session.isWorking = false
    session.abort = null
  }
}

function decisionsById(plan: FieldDecision[]): Map<string, FieldDecision> {
  return new Map(plan.map((decision) => [decision.fieldId, decision]))
}

/**
 * 字段级结果清单：manual/failed/kept 全量，filled 取未验证与带回退消息的（全绿的不打扰）。
 */
function buildFieldReport(
  outcomes: FieldOutcome[],
  observations: FieldObservation[]
): FillFieldReport[] {
  const labelById = new Map(
    observations.map((observation) => [
      observation.descriptor.fieldId,
      observation.descriptor.label || observation.descriptor.fieldId,
    ]),
  )

  return outcomes
    .filter((item) => {
      if (item.outcome === 'filled') {
        return !item.verified || Boolean(item.message)
      }
      return item.outcome !== 'skipped'
    })
    .map((item) => ({
      fieldId: item.fieldId,
      label: labelById.get(item.fieldId) || item.fieldId,
      outcome: item.outcome,
      verified: item.verified,
      message: item.message,
    }))
}
