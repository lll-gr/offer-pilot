/**
 * 填充编排入口：深度扫描 → 扫描字段 → 缓存/AI 映射 → 逐字段填充（或分块多步）。
 * content script 的消息入口，也是唯一持有运行时统计状态的地方；
 * 流水线原语在 pipeline.ts，分块流程在 segmented-flow.ts。
 */

import { CONTENT_SCRIPT_VERSION, MAPPING_CACHE_KEY } from '@/messaging/bridge'
import type { StartFillResponse } from '@/messaging/bridge'
import { formatFieldSummary, formatMappingSummary } from '@/logs/diagnostics'
import { getCatalogWithValues } from '@/resume/schema'
import { triggerExpandableSections } from './deep-scan'
import { clearFieldHighlights, scheduleHighlightAutoClear, showFieldHighlights } from './highlight'
import { buildMappingsForFields, fillFieldsByIds } from './pipeline'
import type { SendLog, SendStats } from './pipeline'
import { requestSelectionRect } from './selection'
import { scanFields } from './scanner/fields'
import type { SelectionRect } from './scanner/fields'
import { runSegmentedFill } from './segmented-flow'
import type { FieldRuntime, FillMode, FillScope } from './types'

let lastFieldCount = 0
let lastMappedCount = 0
let lastFilledCount = 0
let isWorking = false

/** content script 内部的消息出口（由 entrypoints/content.ts 注入） */
export interface FillControllerPort {
  sendLog: SendLog
  sendStats: SendStats
}

function sendLogViaRuntime(level: string, text: string): void {
  chrome.runtime.sendMessage({ type: 'log', level, text }).catch(() => {})
}

function sendStatsViaRuntime(fieldCount: number, mappedCount: number, filledCount: number): void {
  chrome.runtime.sendMessage({ type: 'updateStats', fieldCount, mappedCount, filledCount }).catch(() => {})
}

export function getStatus(): { fieldCount: number; mappedCount: number; filledCount: number } {
  return { fieldCount: lastFieldCount, mappedCount: lastMappedCount, filledCount: lastFilledCount }
}

export function getPingInfo(): { version: string; capabilities: { fullDiagnostics: boolean } } {
  return { version: CONTENT_SCRIPT_VERSION, capabilities: { fullDiagnostics: true } }
}

export async function handleStartFill(
  modelId: string,
  resumeProfile: Record<string, unknown>,
  request: { fillMode?: string; scope?: string } = {},
  port: FillControllerPort = { sendLog: sendLogViaRuntime, sendStats: sendStatsViaRuntime }
): Promise<StartFillResponse> {
  if (isWorking) {
    return { success: false, message: '正在执行中，请稍后再试' }
  }

  isWorking = true
  clearFieldHighlights()

  try {
    if (!resumeProfile || typeof resumeProfile !== 'object') {
      throw new Error('标准简历为空：请先在侧边栏填写或导入标准简历')
    }

    const fillMode: FillMode =
      request?.fillMode === 'incremental' ? 'incremental' : request?.fillMode === 'segmented' ? 'segmented' : 'overwrite'
    const scope: FillScope = request?.scope === 'selection' ? 'selection' : 'page'
    let selectionRect: SelectionRect | null = null

    const sendLog = port.sendLog
    const sendStats: SendStats = (fieldCount, mappedCount, filledCount) => {
      lastFieldCount = fieldCount
      lastMappedCount = mappedCount
      lastFilledCount = filledCount
      port.sendStats(fieldCount, mappedCount, filledCount)
    }

    if (scope === 'selection') {
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
      sendLog('info', '正在探索页面上的可展开区块...')
      await triggerExpandableSections(resumeProfile, (message) => sendLog('info', message))
    }

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

    // --- 映射：先查缓存，未命中调 AI ---
    const { mappingById, cacheHit } = await buildMappingsForFields(scan.fields, resumeProfile, modelId, { sendLog })

    for (const field of scan.fields) {
      const mapping = mappingById.get(field.fieldId) || {
        fieldId: field.fieldId,
        resumePath: '',
        reason: '未返回映射结果',
        transform: { type: 'none' as const },
      }
      sendLog(
        mapping.resumePath ? 'info' : 'warning',
        formatMappingSummary(field, mapping, { source: cacheHit ? 'cache' : 'ai' }),
      )
    }

    const mappedCount = Array.from(mappingById.values()).filter((item) =>
      Boolean(String(item.resumePath || '').trim()),
    ).length

    sendStats(scan.fields.length, mappedCount, 0)
    sendLog(
      'info',
      fillMode === 'incremental' ? '开始根据映射结果执行增量填充...' : '开始根据映射结果执行本地填充...',
    )

    // --- 分块多步填充分支 ---
    if (fillMode === 'segmented') {
      return await runSegmentedFill(scan, resumeProfile, modelId, { sendLog, sendStats })
    }

    // --- 逐字段填充 ---
    const outcome = await fillFieldsByIds(scan.fields, fieldRuntimeMap, mappingById, resumeProfile, {
      fillMode: fillMode === 'incremental' ? 'incremental' : 'overwrite',
      sendLog,
    })

    if (outcome.filledRuntimes.length > 0) {
      showFieldHighlights(outcome.filledRuntimes)
      scheduleHighlightAutoClear()
    }

    sendStats(scan.fields.length, mappedCount, outcome.filledCount)
    sendLog(
      'success',
      `填充完成：映射 ${mappedCount}/${scan.fields.length} 个字段，成功填充 ${outcome.filledCount} 个。请检查后手动提交。`,
    )

    return {
      success: true,
      fieldCount: scan.fields.length,
      mappedCount,
      filledCount: outcome.filledCount,
      cacheHit,
    }
  } catch (error) {
    return { success: false, message: (error as Error)?.message || String(error) }
  } finally {
    isWorking = false
  }
}

export { MAPPING_CACHE_KEY, getCatalogWithValues }
