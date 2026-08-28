/**
 * 填充流水线原语：缓存/AI 映射 + 逐字段填充。
 * controller 主流程与 segmented-flow 分块流程共用，不含编排状态。
 */

import { callAI } from '@/ai/client'
import { parseJsonFromAiText } from '@/ai/json'
import { formatFillSummary, formatSkipSummary, formatValueSummary } from '@/logs/diagnostics'
import { getValueByPath } from '@/resume/schema'
import { fillOne, hasExistingFieldValue } from './filler/modes'
import { deriveFillValue, hasMeaningfulFillValue } from './filler/values'
import {
  createMappingCacheKeyFromSignature,
  createMappingCacheSignature,
  loadMappingCacheEntry,
  saveMappingCacheEntry,
} from './mapping/cache'
import { buildFieldMappingPayload, normalizeMappings } from './mapping/payload'
import type { FieldDescriptor, FieldMapping, FieldRuntime, FillMode } from './types'

export type SendLog = (level: string, text: string) => void
export type SendStats = (fieldCount: number, mappedCount: number, filledCount: number) => void

export interface FieldFillOutcome {
  filledCount: number
  filledRuntimes: FieldRuntime[]
}

/** 逐字段填充（主流程与分块流程共用）。fields 须与 runtimeMap/mappingById 对齐。 */
export async function fillFieldsByIds(
  fields: FieldDescriptor[],
  runtimeMap: Map<string, FieldRuntime>,
  mappingById: Map<string, FieldMapping>,
  resumeProfile: Record<string, unknown>,
  { fillMode, sendLog }: { fillMode: FillMode; sendLog: SendLog }
): Promise<FieldFillOutcome> {
  let filledCount = 0
  const filledRuntimes: FieldRuntime[] = []

  for (const field of fields) {
    const mapping = mappingById.get(field.fieldId)
    if (!mapping?.resumePath) {
      sendLog('warning', formatSkipSummary(field, mapping, 'AI 未匹配到可用的标准简历字段', '', ''))
      continue
    }

    const runtime = runtimeMap.get(field.fieldId)
    if (fillMode === 'incremental' && hasExistingFieldValue(runtime)) {
      sendLog('warning', formatSkipSummary(field, mapping, '字段已有内容，增量模式下不覆盖', '', ''))
      continue
    }

    const rawValue = getValueByPath(resumeProfile, mapping.resumePath)
    const finalValue = deriveFillValue(rawValue, mapping.transform, runtime)

    sendLog('info', formatValueSummary(field, mapping, rawValue, finalValue))

    if (!hasMeaningfulFillValue(finalValue)) {
      sendLog('warning', formatSkipSummary(field, mapping, '标准简历中没有可填写的值，或转换后为空', rawValue, finalValue))
      continue
    }

    const fillResult = await fillOne(runtime, finalValue, {
      overwrite: fillMode !== 'incremental',
      logger: (message) => sendLog('info', message),
    })
    sendLog(
      fillResult.filled ? 'success' : 'warning',
      formatFillSummary({ field, mapping, rawValue, finalValue, fillResult }),
    )
    if (fillResult.filled) {
      filledCount += 1
      if (runtime) filledRuntimes.push(runtime)
    }
  }

  return { filledCount, filledRuntimes }
}

export interface MappingOutcome {
  mappingById: Map<string, FieldMapping>
  cacheHit: boolean
}

/** 缓存/AI 映射（主流程与分块流程的每块复用）。 */
export async function buildMappingsForFields(
  fields: FieldDescriptor[],
  resumeProfile: Record<string, unknown>,
  modelId: string,
  { sendLog }: { sendLog: SendLog }
): Promise<MappingOutcome> {
  const cacheSignature = createMappingCacheSignature(fields)
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

  let mappings: FieldMapping[] = []
  let cacheHit = false

  if (cacheLookup.entry?.mappings?.length) {
    mappings = normalizeMappings(cacheLookup.entry.mappings, fields)
    cacheHit = true
    sendLog('info', '已命中本地字段映射缓存，跳过模型调用。')
  } else {
    sendLog('info', `[缓存] 未命中 reason="${cacheLookup.reason || '未知原因'}"`)
    sendLog('info', `已识别 ${fields.length} 个字段，正在调用 AI 建立字段映射...`)

    const promptPayload = buildFieldMappingPayload(fields, resumeProfile, {
      url: location.href,
      title: document.title,
    })
    const aiText = await callAI(modelId, JSON.stringify(promptPayload), 'field_mapping')
    const parsed = parseJsonFromAiText(aiText) as { mappings?: unknown }
    mappings = normalizeMappings(parsed?.mappings, fields)

    await saveMappingCacheEntry(cacheKey, {
      updatedAt: Date.now(),
      mappings,
      host: location.host,
      path: location.pathname,
      signature: cacheSignature,
    })

    sendLog('success', '字段映射已生成，并已写入本地缓存。')
  }

  const mappingById = new Map<string, FieldMapping>()
  for (const mapping of mappings || []) {
    if (!mapping?.fieldId) continue
    mappingById.set(String(mapping.fieldId), mapping)
  }

  return { mappingById, cacheHit }
}
