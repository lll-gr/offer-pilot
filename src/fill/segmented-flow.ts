/**
 * 分块多步填充编排：逐块填写 → 推进决策（责任链：规则→AI→人工）→ 等待翻页 → 重扫描续填。
 * 不自动提交；统计经 onStats 回调上报（controller 持有运行时状态）。
 */

import type { FillFieldReport, StartFillResponse } from '@/messaging/bridge'
import type { FieldProgressEvent, PhaseEvent } from '@/messaging/events'
import { decideAdvance } from './advance-deciders'
import { scheduleHighlightAutoClear, showFieldHighlights } from './highlight'
import { observeFields } from './observe'
import { runPlanExecute } from './plan-execute'
import type { SendLog, SendStats } from './execute/pipeline'
import { scanFields } from './scanner/fields'
import type { FieldOutcome, ScanResult } from './types'
import { detectFormSegments, findNextStepCandidates, waitForSegmentChange } from './segments'
import type { FieldRuntime } from './types'

export interface SegmentedFlowDeps {
  sendLog: SendLog
  sendStats: SendStats
  signal?: AbortSignal
  /** 观察者推送：阶段事件（planning/aiBatch） */
  onPhase?: (event: PhaseEvent) => void
  /** 观察者推送：字段级进度事件（UI 实时进度） */
  onFieldProgress?: (event: FieldProgressEvent) => void
  /** 应用设置（轮数上限/分批大小/重试次数/高亮延时） */
  maxRounds?: number
  batchSize?: number
  retryCount?: number
  highlightAutoClearMs?: number
}

/** 字段级结果清单（与 controller.buildFieldReport 同口径；跨块累计） */
function collectSegmentReport(
  outcomes: FieldOutcome[],
  labelById: Map<string, string>
): FillFieldReport[] {
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

/** 分块多步填充主循环：当前页所有块顺序填完 → 等待翻页 → 重扫描续填。 */
export async function runSegmentedFill(
  initialScan: ScanResult,
  resumeProfile: Record<string, unknown>,
  modelId: string,
  { sendLog, sendStats, signal, onPhase, onFieldProgress, maxRounds, batchSize, retryCount, highlightAutoClearMs }: SegmentedFlowDeps
): Promise<StartFillResponse> {
  let scan = initialScan
  let totalFilled = 0
  let totalMapped = 0
  let segmentRound = 0
  const fieldReport: FillFieldReport[] = []
  const labelById = new Map<string, string>()

  const reportStats = (fieldCount: number) => {
    sendStats(fieldCount, totalMapped, totalFilled)
  }

  const roundLimit = Math.max(1, maxRounds ?? 30)
  while (segmentRound < roundLimit) {
    if (signal?.aborted) {
      scheduleHighlightAutoClear()
      sendLog('warning', '收到停止指令，分步填充已中止。')
      break
    }

    const fieldRuntimeMap = new Map<string, FieldRuntime>()
    for (const runtime of scan.runtime) {
      fieldRuntimeMap.set(runtime.fieldId, runtime)
    }

    const segments = detectFormSegments(scan.fields, fieldRuntimeMap)
    if (segments.length === 0) {
      scheduleHighlightAutoClear()
      sendLog('success', `分步填充完成：共填写 ${totalFilled} 个字段。请检查后手动提交。`)
      break
    }

    // 单页多块：当前页所有块顺序填完，而不是只填第一块
    const filledFieldIds = new Set<string>()
    for (const [segmentIndex, segment] of segments.entries()) {
      const segmentFields = scan.fields.filter(
        (field) => segment.fieldIds.includes(field.fieldId) && !filledFieldIds.has(field.fieldId),
      )
      if (segmentFields.length === 0) continue

      sendLog(
        'info',
        `第 ${segmentRound + 1} 轮 · 块 ${segmentIndex + 1}/${segments.length}（${segmentFields.length} 个字段）...`,
      )

      const segmentObservations = observeFields(segmentFields, fieldRuntimeMap)
      for (const observation of segmentObservations) {
        labelById.set(
          observation.descriptor.fieldId,
          observation.descriptor.label || observation.descriptor.fieldId,
        )
      }
      const segmentResult = await runPlanExecute(segmentObservations, resumeProfile, modelId, {
        fillMode: 'overwrite',
        sendLog,
        signal,
        onPhase,
        onFieldProgress,
        retryCount,
        batchSize,
      })
      // 本块的映射/填充数累加进全局统计（onMapped/onProgress 不接，块级无需中途上报）
      totalMapped += segmentResult.plan.filter((decision) => Boolean(decision.resumePath?.trim())).length
      totalFilled += segmentResult.filledCount
      fieldReport.push(...collectSegmentReport(segmentResult.outcomes, labelById))
      segmentFields.forEach((field) => filledFieldIds.add(field.fieldId))

      if (segmentResult.filledRuntimes.length > 0) {
        showFieldHighlights(segmentResult.filledRuntimes)
      }
    }

    reportStats(scan.fields.length)
    segmentRound += 1

    sendLog('info', '本页所有块已填写完成，正在确认下一步操作...')

    const segmentEls = Array.from(filledFieldIds)
      .map((fieldId) => fieldRuntimeMap.get(fieldId)?.el)
      .filter(Boolean) as Element[]

    // 推进决策：责任链（规则→AI→人工）
    const candidates = findNextStepCandidates()
    const verdict = await decideAdvance({
      ctx: {
        segmentIndex: segmentRound - 1,
        segmentTotal: segmentRound,
        lastSegmentLabels: scan.fields
          .filter((field) => filledFieldIds.has(field.fieldId))
          .map((field) => field.label || field.fieldId),
        candidates: candidates.map((item) => ({ text: item.text })),
      },
      candidates,
      modelId,
      sendLog,
      signal,
    })

    if (verdict.kind === 'stop') {
      scheduleHighlightAutoClear()
      sendLog('success', `分步填充终止：${verdict.reason || '决策链建议停止'}。共填写 ${totalFilled} 个字段。`)
      break
    }

    if (verdict.kind === 'ask_human') {
      sendLog('warning', '请手动点击页面上的下一步/提交按钮，我会自动继续填写下一块。')
    } else if (verdict.kind === 'wait') {
      sendLog('info', `AI 建议等待页面变化（${verdict.reason}）。`)
    }

    const changed = await waitForSegmentChange(segmentEls, { signal })

    if (!changed) {
      scheduleHighlightAutoClear()
      sendLog('warning', '等待页面变化超时，分步填充已停止。你可以重新发起分步填入继续。')
      break
    }

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
        // 骤变场景：直接问 AI（走决策链会先过规则环，但此处没有可点的推进按钮，
        // 规则环自然放行到 AI 环），只需要 stop/继续 的判断
        const anomalyCandidates = findNextStepCandidates()
        const verdict = await decideAdvance({
          ctx: {
            segmentIndex: segmentRound - 1,
            segmentTotal: segmentRound,
            lastSegmentLabels: scan.fields
              .filter((field) => filledFieldIds.has(field.fieldId))
              .map((field) => field.label || field.fieldId),
            candidates: anomalyCandidates.map((item) => ({ text: item.text })),
            newFieldLabels: scan.fields.map((field) => field.label || field.fieldId).slice(0, 15),
            anomaly: `字段数从 ${prevFieldCount} 变为 ${scan.fields.length}`,
          },
          candidates: anomalyCandidates,
          modelId,
          sendLog,
          signal,
        })

        if (verdict.kind === 'stop') {
          scheduleHighlightAutoClear()
          sendLog('warning', `AI 建议终止：${verdict.reason}`)
          break
        }
        if (verdict.kind === 'ask_human') {
          sendLog('warning', `AI 不确定是否继续（${verdict.reason}），请手动确认页面状态；将继续尝试填写当前块。`)
        }
      }
    }
  }

  return {
    success: true,
    canceled: Boolean(signal?.aborted),
    fieldCount: scan.fields.length,
    mappedCount: totalMapped,
    filledCount: totalFilled,
    segmentCount: segmentRound,
    fieldReport,
  }
}
