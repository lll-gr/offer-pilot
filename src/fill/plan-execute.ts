/**
 * 两段执行编排：确定性优先。
 * 规则环命中的字段立即执行（pass1，零 token 零延迟），用户秒见确定字段被填；
 * 剩余不确定字段走缓存/AI 规划后再执行（pass2）。
 * AI 失败/超时时 pass1 的成果保留（部分成功），controller 与 segmented-flow 共用。
 */

import { formatMappingSummary } from '@/logs/diagnostics'
import type { FieldProgressEvent, PhaseEvent } from '@/messaging/events'
import { executePlan } from './execute/pipeline'
import type { SendLog } from './execute/pipeline'
import {
  alignCachedDecisions,
  createFieldKey,
  createMappingCacheKeyFromSignature,
  createMappingCacheSignature,
  loadMappingCacheEntry,
  saveMappingCacheEntry,
} from './plan/cache'
import type { CacheFieldSignature } from './plan/cache'
import { planWithAi } from './plan/build'
import type { CallAiFn } from './plan/build'
import { normalizeDecisions } from './plan/payload'
import { planByRules } from './plan/rule-planner'
import { refinePlan } from './plan/rules'
import type { FieldDecision, FieldObservation, FieldOutcome, FieldRuntime, FillMode } from './types'

export interface PlanExecuteDeps {
  fillMode: FillMode
  sendLog: SendLog
  signal?: AbortSignal
  onPhase?: (event: PhaseEvent) => void
  onFieldProgress?: (event: FieldProgressEvent) => void
  /** 累计已映射字段数（跨两段递增，controller 据此上报统计） */
  onMapped?: (totalMapped: number) => void
  /** 累计已填充字段数（跨两段递增） */
  onProgress?: (totalFilled: number) => void
  retryCount?: number
  batchSize?: number
  cacheMaxEntries?: number
  /** 测试注入 */
  callAi?: CallAiFn
  payloadMeta?: { url: string; title: string }
  storage?: Parameters<typeof loadMappingCacheEntry>[2]
  /** 缓存 key 的位置来源（缺省 location） */
  locationMeta?: { origin: string; pathname: string; host: string }
}

export interface PlanExecuteResult {
  plan: FieldDecision[]
  cacheHit: boolean
  filledCount: number
  filledRuntimes: FieldRuntime[]
  outcomes: FieldOutcome[]
  /** 规则环直接命中的字段数（日志/统计展示用） */
  ruleDecidedCount: number
  /** 整页字段签名（controller 纠错回写缓存用） */
  cacheSignature: CacheFieldSignature[]
}

export async function runPlanExecute(
  observations: FieldObservation[],
  resumeProfile: Record<string, unknown>,
  modelId: string,
  deps: PlanExecuteDeps
): Promise<PlanExecuteResult> {
  const {
    fillMode,
    sendLog,
    signal,
    onPhase,
    onFieldProgress,
    onMapped,
    onProgress,
    retryCount,
    batchSize,
    cacheMaxEntries,
    callAi,
    payloadMeta,
    storage,
    locationMeta,
  } = deps

  const loc = locationMeta ?? {
    origin: location.origin,
    pathname: location.pathname,
    host: location.host,
  }

  const fields = observations.map((observation) => observation.descriptor)
  const observationById = new Map(
    observations.map((observation) => [observation.descriptor.fieldId, observation]),
  )

  const logMapping = (observation: FieldObservation, decision: FieldDecision, source: string) => {
    sendLog(
      decision.resumePath || decision.action !== 'skip' ? 'info' : 'warning',
      formatMappingSummary(observation.descriptor, decision, { source }),
    )
  }

  // --- 责任链第一环：规则规划 → 立即执行（pass1） ---
  const { decisions: rawRuleDecisions, remaining } = planByRules(observations, resumeProfile)
  const ruleDecisions = refinePlan(rawRuleDecisions, observations)
  const ruleObservations = ruleDecisions
    .map((decision) => observationById.get(decision.fieldId))
    .filter(Boolean) as FieldObservation[]

  const outcomes: FieldOutcome[] = []
  const filledRuntimes: FieldRuntime[] = []
  let filledCount = 0
  let ruleDecidedCount = 0

  if (ruleDecisions.length > 0) {
    sendLog(
      'info',
      `规则环确定性命中 ${ruleDecisions.length} 个字段（label/name/autocomplete），直接填充，无需等待 AI。`,
    )
    ruleDecidedCount = ruleDecisions.length
    onMapped?.(ruleDecisions.filter((decision) => decision.resumePath?.trim()).length)

    for (const decision of ruleDecisions) {
      const observation = observationById.get(decision.fieldId)
      if (observation) logMapping(observation, decision, 'rule')
    }

    onPhase?.({ type: 'phase', phase: 'executing' })
    const pass1 = await executePlan(ruleObservations, new Map(ruleDecisions.map((decision) => [decision.fieldId, decision])), resumeProfile, {
      fillMode,
      sendLog,
      signal,
      onFieldProgress,
      retryCount,
      progressOffset: 0,
      progressTotal: observations.length,
      onProgress: (count) => onProgress?.(count),
    })
    outcomes.push(...pass1.outcomes)
    filledRuntimes.push(...pass1.filledRuntimes)
    filledCount += pass1.filledCount
  }

  if (remaining.length === 0 || signal?.aborted) {
    return {
      plan: ruleDecisions,
      cacheHit: false,
      filledCount,
      filledRuntimes,
      outcomes,
      ruleDecidedCount,
      cacheSignature: createMappingCacheSignature(fields),
    }
  }

  // --- 责任链第二环：缓存/AI 规划剩余字段（签名按整页算，缓存行为不变） ---
  onPhase?.({ type: 'phase', phase: 'planning' })
  const cacheSignature = createMappingCacheSignature(fields)
  const cacheKey = createMappingCacheKeyFromSignature(cacheSignature, loc)

  const cacheLookup = await loadMappingCacheEntry(
    cacheKey,
    { host: loc.host, path: loc.pathname, signature: cacheSignature },
    storage,
  )

  let aiDecisions: FieldDecision[] = []
  let cacheHit = false

  if (cacheLookup.entry?.decisions?.length) {
    // 重放对齐：按字段指纹把缓存决策安到当前扫描字段（序号无关）
    const aligned = alignCachedDecisions(
      cacheLookup.entry.decisions,
      remaining.map((observation) => observation.descriptor),
    )
    aiDecisions = normalizeDecisions(aligned, remaining)
    cacheHit = true
    sendLog(
      'info',
      `已命中本地填表决策缓存（${aiDecisions.length}/${cacheLookup.entry.decisions.length} 条按指纹对齐），跳过模型调用。`,
    )
  } else {
    sendLog('info', `[缓存] 未命中 reason="${cacheLookup.reason || '未知原因'}"`)
    sendLog('info', `已识别 ${remaining.length} 个待规划字段，正在调用 AI 制定填充计划...`)

    aiDecisions = await planWithAi(remaining, resumeProfile, modelId, {
      sendLog,
      signal,
      onPhase,
      batchSize,
      callAi,
      payloadMeta,
    })

    // 写缓存：规则环与 AI 环的决策合并后统一落盘（带字段指纹），下次整页重放
    const mergedForCache = [...ruleDecisions, ...aiDecisions].map((decision) => {
      const observation = observationById.get(decision.fieldId)
      return observation ? { ...decision, fieldKey: createFieldKey(observation.descriptor) } : decision
    })

    await saveMappingCacheEntry(
      cacheKey,
      {
        updatedAt: Date.now(),
        decisions: mergedForCache,
        host: loc.host,
        path: loc.pathname,
        signature: cacheSignature,
      },
      storage,
      cacheMaxEntries ? { maxEntries: cacheMaxEntries } : undefined,
    )
    sendLog('success', '填充计划已生成，并已写入本地缓存。')
  }

  // --- 责任链第三环：本地防线 + 执行（pass2） ---
  const refinedAiDecisions = refinePlan(aiDecisions, remaining)
  onMapped?.(
    ruleDecisions.filter((decision) => decision.resumePath?.trim()).length +
      refinedAiDecisions.filter((decision) => decision.resumePath?.trim()).length,
  )

  for (const decision of refinedAiDecisions) {
    const observation = observationById.get(decision.fieldId)
    if (observation) logMapping(observation, decision, cacheHit ? 'cache' : 'ai')
  }

  const decisionMap = new Map(refinedAiDecisions.map((decision) => [decision.fieldId, decision]))
  for (const observation of remaining) {
    if (decisionMap.has(observation.descriptor.fieldId)) continue
    logMapping(
      observation,
      {
        fieldId: observation.descriptor.fieldId,
        action: 'skip',
        resumePath: '',
        reason: '未返回决策结果',
        transform: { type: 'none' },
      },
      cacheHit ? 'cache' : 'ai',
    )
  }

  onPhase?.({ type: 'phase', phase: 'executing' })
  const pass2 = await executePlan(remaining, decisionMap, resumeProfile, {
    fillMode,
    sendLog,
    signal,
    onFieldProgress,
    retryCount,
    progressOffset: ruleObservations.length,
    progressTotal: observations.length,
    onProgress: (count) => onProgress?.(filledCount + count),
  })
  outcomes.push(...pass2.outcomes)
  filledRuntimes.push(...pass2.filledRuntimes)
  filledCount += pass2.filledCount

  return {
    plan: [...ruleDecisions, ...refinedAiDecisions],
    cacheHit,
    filledCount,
    filledRuntimes,
    outcomes,
    ruleDecidedCount,
    cacheSignature,
  }
}
