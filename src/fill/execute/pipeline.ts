/**
 * 执行流水线：消费 FillPlan 逐字段执行，产出 FieldOutcome。
 * 决策（跳过/保留/人工/修正）已在 plan 阶段完成，这里只做取值与写入；
 * 规划编排见 plan/build.ts。controller/segmented-flow 共用，不含编排状态。
 */

import { formatFillSummary, formatSkipSummary, formatValueSummary } from '@/logs/diagnostics'
import type { FieldProgressEvent, LogLevel } from '@/messaging/events'
import { getValueByPath } from '@/resume/schema'
import type {
  FieldDecision,
  FieldObservation,
  FieldOutcome,
  FieldRuntime,
  FillMode,
} from '../types'
import { fillOne } from './strategies'
import type { FillContext } from './strategies'
import { deriveFillValue, hasMeaningfulFillValue } from './values'

export type SendLog = (level: LogLevel, text: string) => void
export type SendStats = (fieldCount: number, mappedCount: number, filledCount: number) => void

export interface ExecuteOutcome {
  filledCount: number
  filledRuntimes: FieldRuntime[]
  outcomes: FieldOutcome[]
}

/**
 * 逐字段执行填充计划。observations 顺序即执行顺序；
 * decisionsById 为空（无决策）的字段记跳过日志不执行。
 * onFieldStart/onFieldProgress 驱动 UI 实时进度。
 */
export async function executePlan(
  observations: FieldObservation[],
  decisionsById: Map<string, FieldDecision>,
  resumeProfile: Record<string, unknown>,
  {
    fillMode,
    sendLog,
    signal,
    onFieldStart,
    onProgress,
    onFieldProgress,
    retryCount,
  }: {
    fillMode: FillMode
    sendLog: SendLog
    signal?: AbortSignal
    onFieldStart?: FillContext['onFieldStart']
    onProgress?: (filledCount: number) => void
    onFieldProgress?: (event: FieldProgressEvent) => void
    retryCount?: number
  }
): Promise<ExecuteOutcome> {
  let filledCount = 0
  let processedCount = 0
  const filledRuntimes: FieldRuntime[] = []
  const outcomes: FieldOutcome[] = []
  const total = observations.length

  const fieldLabel = (observation: FieldObservation): string =>
    observation.descriptor.label || observation.descriptor.fieldId

  const emitProgress = (
    observation: FieldObservation,
    status: FieldProgressEvent['status'],
    extra?: { verified?: boolean; message?: string }
  ) => {
    processedCount += 1
    onFieldProgress?.({
      type: 'fieldProgress',
      fieldId: observation.descriptor.fieldId,
      label: fieldLabel(observation),
      status,
      verified: extra?.verified,
      message: extra?.message,
      processed: processedCount,
      total,
    })
  }

  for (const observation of observations) {
    if (signal?.aborted) {
      sendLog('warning', '收到停止指令，填充已中止。')
      break
    }

    const field = observation.descriptor
    const runtime = observation.runtime
    const decision = decisionsById.get(field.fieldId)

    onFieldProgress?.({
      type: 'fieldProgress',
      fieldId: field.fieldId,
      label: fieldLabel(observation),
      status: 'pending',
      processed: processedCount,
      total,
    })

    if (!decision || decision.action === 'skip') {
      const detail = decision
        ? `AI 判定跳过：${decision.reason || '与简历无关或无值可填'}`
        : 'AI 未返回该字段的决策'
      sendLog('info', formatSkipSummary(field, decision, detail, '', ''))
      outcomes.push({ fieldId: field.fieldId, outcome: 'skipped', verified: false })
      emitProgress(observation, 'skipped')
      continue
    }

    if (decision.action === 'manual') {
      sendLog(
        'warning',
        formatSkipSummary(field, decision, `建议人工填写：${decision.reason || '字段需要人工确认'}`, '', ''),
      )
      outcomes.push({ fieldId: field.fieldId, outcome: 'manual', verified: false })
      emitProgress(observation, 'manual')
      continue
    }

    if (decision.action === 'keep') {
      sendLog(
        'info',
        formatSkipSummary(field, decision, `保留现有值：${decision.reason || '当前值已正确'}`, '', ''),
      )
      outcomes.push({ fieldId: field.fieldId, outcome: 'kept', verified: false })
      emitProgress(observation, 'kept')
      continue
    }

    // fill / correct：correct 表示 AI 判定现有值与档案不符，增量模式下仍修正
    if (fillMode === 'incremental' && observation.hasValue && decision.action === 'fill') {
      sendLog('warning', formatSkipSummary(field, decision, '字段已有内容，增量模式下不覆盖', '', ''))
      outcomes.push({ fieldId: field.fieldId, outcome: 'skipped', verified: false })
      emitProgress(observation, 'skipped')
      continue
    }
    if (fillMode === 'incremental' && observation.hasValue && decision.action === 'correct') {
      sendLog('info', `字段 ${field.label || field.fieldId} 现有值与档案不符，增量模式下仍按决策修正。`)
    }

    if (!decision.resumePath) {
      sendLog('warning', formatSkipSummary(field, decision, '决策缺少可用的标准简历字段', '', ''))
      outcomes.push({ fieldId: field.fieldId, outcome: 'skipped', verified: false })
      emitProgress(observation, 'skipped')
      continue
    }

    const rawValue = getValueByPath(resumeProfile, decision.resumePath)
    const finalValue = deriveFillValue(rawValue, decision.transform, runtime)

    sendLog('info', formatValueSummary(field, decision, rawValue, finalValue))

    if (!hasMeaningfulFillValue(finalValue)) {
      sendLog(
        'warning',
        formatSkipSummary(field, decision, '标准简历中没有可填写的值，或转换后为空', rawValue, finalValue),
      )
      outcomes.push({ fieldId: field.fieldId, outcome: 'skipped', verified: false })
      emitProgress(observation, 'skipped')
      continue
    }

    const fillResult = await fillOne(runtime, finalValue, {
      overwrite: fillMode !== 'incremental' || decision.action === 'correct',
      logger: (message) => sendLog('info', message),
      signal,
      onFieldStart,
      retryCount,
    })
    sendLog(
      fillResult.filled ? 'success' : 'warning',
      formatFillSummary({ field, mapping: decision, rawValue, finalValue, fillResult }),
    )

    if (fillResult.filled) {
      filledCount += 1
      if (runtime) filledRuntimes.push(runtime)
      outcomes.push({
        fieldId: field.fieldId,
        outcome: 'filled',
        verified: Boolean(fillResult.verified),
        message: fillResult.message,
        runtime,
      })
      emitProgress(observation, 'filled', { verified: Boolean(fillResult.verified), message: fillResult.message })
    } else {
      outcomes.push({
        fieldId: field.fieldId,
        outcome: 'failed',
        verified: false,
        message: fillResult.message,
      })
      emitProgress(observation, 'failed', { message: fillResult.message })
    }
    onProgress?.(filledCount)
  }

  return { filledCount, filledRuntimes, outcomes }
}
