/**
 * 分块多步填充编排：逐块填写 → 下一步决策（规则→AI→人工三级兜底）→ 等待翻页 → 重扫描续填。
 * 不自动提交；统计经 onStats 回调上报（controller 持有运行时状态）。
 */

import { callAI } from '@/ai/client'
import { parseJsonFromAiText } from '@/ai/json'
import type { StartFillResponse } from '@/messaging/bridge'
import { buildDecisionPrompt, normalizeDecisionResponse } from './decision'
import type { DecisionContext, SegmentDecision } from './decision'
import { clickLikeUser } from './filler/dom'
import { scheduleHighlightAutoClear, showFieldHighlights } from './highlight'
import { buildMappingsForFields, fillFieldsByIds } from './pipeline'
import type { SendLog, SendStats } from './pipeline'
import { scanFields } from './scanner/fields'
import type { ScanResult } from './types'
import { detectFormSegments, findNextStepCandidates, waitForSegmentChange } from './segments'
import type { FieldRuntime } from './types'

export interface SegmentedFlowDeps {
  sendLog: SendLog
  sendStats: SendStats
}

/** 分块多步填充主循环。 */
export async function runSegmentedFill(
  initialScan: ScanResult,
  resumeProfile: Record<string, unknown>,
  modelId: string,
  { sendLog, sendStats }: SegmentedFlowDeps
): Promise<StartFillResponse> {
  let scan = initialScan
  let totalFilled = 0
  let totalMapped = 0
  let segmentIndex = 0

  const reportStats = (fieldCount: number) => {
    sendStats(fieldCount, totalMapped, totalFilled)
  }

  while (true) {
    const fieldRuntimeMap = new Map<string, FieldRuntime>()
    for (const runtime of scan.runtime) {
      fieldRuntimeMap.set(runtime.fieldId, runtime)
    }

    const segments = detectFormSegments(scan.fields, fieldRuntimeMap)
    if (segments.length === 0) {
      break
    }

    // 只处理含字段的块；当前轮按序处理第一块（其余块属于「下一页」的内容）
    const segment = segments[0]
    const segmentFields = scan.fields.filter((field) => segment.fieldIds.includes(field.fieldId))

    sendLog('info', `开始处理第 ${segmentIndex + 1} 块（本页共 ${segments.length} 块，块内 ${segmentFields.length} 个字段）...`)

    const { mappingById } = await buildMappingsForFields(segmentFields, resumeProfile, modelId, { sendLog })
    totalMapped += Array.from(mappingById.values()).filter((item) => Boolean(item.resumePath?.trim())).length

    const outcome = await fillFieldsByIds(segmentFields, fieldRuntimeMap, mappingById, resumeProfile, {
      fillMode: 'overwrite',
      sendLog,
    })
    totalFilled += outcome.filledCount

    if (outcome.filledRuntimes.length > 0) {
      showFieldHighlights(outcome.filledRuntimes)
    }

    reportStats(scan.fields.length)

    // 剩余块属于后续步骤：先等用户翻页
    const hasMoreSegments = segments.length > 1
    if (!hasMoreSegments) {
      scheduleHighlightAutoClear()
      sendLog('success', `分步填充完成：共填写 ${totalFilled} 个字段。请检查后手动提交。`)
      break
    }

    sendLog('info', `第 ${segmentIndex + 1} 块填写完成，正在确认下一步操作...`)

    const segmentEls = segmentFields
      .map((field) => fieldRuntimeMap.get(field.fieldId)?.el)
      .filter(Boolean) as Element[]

    // 规则优先：唯一候选直接点击；0 或多个候选时咨询 AI
    const candidates = findNextStepCandidates(segment.rootEl)
    const proceed = await decideAndAdvance(
      {
        segmentIndex,
        segmentTotal: segments.length,
        lastSegmentLabels: segmentFields.map((field) => field.label || field.fieldId),
        candidates: candidates.map((item) => ({ text: item.text })),
      },
      candidates,
      modelId,
      { sendLog },
    )

    if (proceed === 'stop') {
      scheduleHighlightAutoClear()
      sendLog('success', `分步填充终止：共填写 ${totalFilled} 个字段。`)
      break
    }

    const changed = await waitForSegmentChange(segmentEls)

    if (!changed) {
      scheduleHighlightAutoClear()
      sendLog('warning', '等待页面变化超时，分步填充已停止。你可以重新发起分步填入继续。')
      break
    }

    segmentIndex += 1
    sendLog('info', '检测到页面已翻页，正在扫描新的表单内容...')

    // 重扫描（字段结构可能不同，映射缓存 key 随之变化）；字段数骤变时咨询 AI 确认
    const prevFieldCount = scan.fields.length
    scan = scanFields({ scope: 'page', selectionRect: null })
    if (scan.fields.length === 0) {
      scheduleHighlightAutoClear()
      sendLog('success', '新页面未识别到可填写字段，分步填充结束。')
      break
    }

    if (prevFieldCount > 0) {
      const ratio = scan.fields.length / prevFieldCount
      if (ratio < 0.3 || ratio > 3) {
        sendLog('warning', `检测到字段数骤变（${prevFieldCount} → ${scan.fields.length}），正在请 AI 确认是否继续...`)
        const decision = await consultDecision(
          {
            segmentIndex,
            segmentTotal: segments.length,
            lastSegmentLabels: segmentFields.map((field) => field.label || field.fieldId),
            candidates: findNextStepCandidates().map((item) => ({ text: item.text })),
            newFieldLabels: scan.fields.map((field) => field.label || field.fieldId).slice(0, 15),
            anomaly: `字段数从 ${prevFieldCount} 变为 ${scan.fields.length}`,
          },
          modelId,
          { sendLog },
        )

        if (decision.action === 'stop') {
          scheduleHighlightAutoClear()
          sendLog('warning', `AI 建议终止：${decision.reason}`)
          break
        }
        if (decision.action === 'ask_human') {
          sendLog('warning', `AI 不确定是否继续（${decision.reason}），请手动确认页面状态；将继续尝试填写当前块。`)
        }
      }
    }
  }

  return {
    success: true,
    fieldCount: scan.fields.length,
    mappedCount: totalMapped,
    filledCount: totalFilled,
    segmentCount: segmentIndex + 1,
  }
}

/** 单次 AI 决策咨询（失败静默回退 ask_human） */
async function consultDecision(
  ctx: DecisionContext,
  modelId: string,
  { sendLog }: { sendLog: SendLog }
): Promise<SegmentDecision> {
  try {
    const prompt = buildDecisionPrompt(ctx)
    const aiText = await callAI(modelId, prompt, 'segment_decision')
    const decision = normalizeDecisionResponse(parseJsonFromAiText(aiText), (ctx.candidates || []).length)
    sendLog('info', `[AI决策] ${decision.action}${decision.buttonIndex >= 0 ? ` #${decision.buttonIndex}` : ''}：${decision.reason || '（无理由）'}`)
    return decision
  } catch (error) {
    sendLog('warning', `AI 决策咨询失败（${(error as Error).message}），回退为等待人工操作。`)
    return { action: 'ask_human', buttonIndex: -1, reason: 'AI 调用失败' }
  }
}

/**
 * 按钮歧义时的推进决策：唯一候选直接点（纯规则免 AI）；
 * 0 或 ≥2 候选咨询 AI；click→代点，wait/ask_human→提示用户手动点，stop→终止。
 * 返回 'stop' 表示应终止流程。
 */
async function decideAndAdvance(
  ctx: DecisionContext,
  candidates: { text: string; el: Element }[],
  modelId: string,
  { sendLog }: { sendLog: SendLog }
): Promise<'stop' | 'continue'> {
  if (candidates.length === 1) {
    sendLog('info', `检测到唯一候选按钮「${candidates[0].text}」，代为点击。`)
    clickLikeUser(candidates[0].el)
    return 'continue'
  }

  const decision = await consultDecision(ctx, modelId, { sendLog })

  if (decision.action === 'click' && candidates[decision.buttonIndex]) {
    sendLog('info', `按 AI 建议点击「${candidates[decision.buttonIndex].text}」。`)
    clickLikeUser(candidates[decision.buttonIndex].el)
    return 'continue'
  }

  if (decision.action === 'stop') {
    return 'stop'
  }

  if (decision.action === 'wait') {
    sendLog('info', `AI 建议等待页面变化（${decision.reason}）。`)
    return 'continue'
  }

  // ask_human / click 越界（已在 normalize 回退）：等用户手动操作
  sendLog('warning', '请手动点击页面上的下一步/提交按钮，我会自动继续填写下一块。')
  return 'continue'
}
