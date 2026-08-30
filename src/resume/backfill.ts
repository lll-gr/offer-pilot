/**
 * 页面回填简历：把页面上已填的表单值反向补充进标准简历的空缺字段。
 * 分工：AI 只产出 fieldId → resumePath 的映射（不产出值，天然反幻觉）；
 * 值从页面快照原样取。写入边界在代码里——只允许写空字段，
 * 非空且不等价的记为冲突交用户裁决，绝不覆盖。
 */

import type { FilledFieldSnapshot } from '@/messaging/bridge'
import { sanitizePageUrl } from '@/fill/plan/payload'
import { parseJsonFromAiText } from '@/ai/json'
import {
  getFieldCatalog,
  getCatalogWithValues,
  getValueByPath,
  normalizeDateValue,
  normalizeForMatch,
  setValueByPath,
} from './schema'
import type { ResumeProfile } from './schema'

/** 页面值写入上限（超长textarea截断，防异常页面拖垮档案） */
const PAGE_VALUE_WRITE_LIMIT = 2000

const JUNK_VALUE_PATTERN = /^(无|暂无|不适用|暂无信息|none|n\/a|null|undefined|[-—·]+)$/i

/** 派生字段（归一化时按真源重算，写入无意义） */
const DERIVED_RESUME_PATHS = new Set(['personal.age', 'personal.isFreshGraduate'])

export interface BackfillMapping {
  fieldId: string
  resumePath: string
  reason: string
}

export interface BackfillUpdate {
  resumePath: string
  value: string
  sourceLabel: string
  reason: string
}

export interface BackfillConflict {
  resumePath: string
  resumeValue: string
  pageValue: string
  sourceLabel: string
}

export interface BackfillResult {
  updates: BackfillUpdate[]
  conflicts: BackfillConflict[]
  ignored: number
}

export interface BackfillApplyResult {
  profile: ResumeProfile
  result: BackfillResult
}

export interface BackfillPayload {
  url: string
  title: string
  pageFields: Array<{
    fieldId: string
    kind: string
    label: string
    placeholder: string
    context: string
    sectionLabel: string
    nearbyLabels: string[]
    options: string[]
    value: string
  }>
  resumeFields: Array<{
    path: string
    label: string
    sectionLabel: string
    itemLabel: string
    input: string
    hasValue: boolean
    valuePreview: string
    options: string[]
  }>
}

export function buildBackfillPayload(
  fields: FilledFieldSnapshot[],
  profile: ResumeProfile,
  { url, title }: { url: string; title: string }
): BackfillPayload {
  return {
    url: sanitizePageUrl(url),
    title: String(title || '').slice(0, 120),
    pageFields: fields.map((field) => ({
      fieldId: field.fieldId,
      kind: field.kind,
      label: field.label,
      placeholder: field.placeholder || '',
      context: field.context || '',
      sectionLabel: field.sectionLabel || '',
      nearbyLabels: field.nearbyLabels || [],
      options: (field.options || []).slice(0, 60),
      value: String(field.value || '').slice(0, 300),
    })),
    resumeFields: getCatalogWithValues(profile).map((field) => ({
      path: field.path,
      label: field.label,
      sectionLabel: field.sectionLabel,
      itemLabel: field.itemLabel || '',
      input: field.input,
      hasValue: Boolean(field.hasValue),
      valuePreview: field.valuePreview || '',
      options: field.options || [],
    })),
  }
}

/**
 * 归一化 AI 映射：过滤未知 fieldId / 目录外 resumePath，同一页面字段只取第一条。
 * 原始输入为 parseJsonFromAiText 的结果（{ mappings: [...] }）。
 */
export function normalizeBackfillMappings(
  rawPayload: unknown,
  fields: FilledFieldSnapshot[]
): BackfillMapping[] {
  const container = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as {
    mappings?: unknown
  }
  const validFieldIds = new Set(fields.map((field) => field.fieldId))
  const validResumePaths = new Set(getFieldCatalog({ mode: 'max' }).map((field) => field.path))

  const mappings: BackfillMapping[] = []
  const seenFieldIds = new Set<string>()

  for (const item of Array.isArray(container.mappings) ? container.mappings : []) {
    const record = item as Record<string, unknown>
    const fieldId = String(record?.fieldId || '').trim()
    const resumePath = String(record?.resumePath || '').trim()
    if (!fieldId || !validFieldIds.has(fieldId)) continue
    if (seenFieldIds.has(fieldId)) continue
    if (!resumePath || !validResumePaths.has(resumePath)) continue

    seenFieldIds.add(fieldId)
    mappings.push({
      fieldId,
      resumePath,
      reason: String(record?.reason || '')
        .trim()
        .slice(0, 160),
    })
  }

  return mappings
}

function isEquivalentBackfillValue(left: string, right: string): boolean {
  if (left === right) return true
  if (normalizeForMatch(left) === normalizeForMatch(right)) return true

  // 日期写法差异（2020.06 / 2020年6月 vs 2020-06）：规范化后比对；
  // 无法解析时 normalizeDateValue 原样返回，等价于首个全等判断
  const leftDate = normalizeDateValue(left)
  const rightDate = normalizeDateValue(right)
  return Boolean(leftDate && leftDate === rightDate && leftDate !== left && rightDate !== right)
}

/** 应用回填：返回更新后的 profile 副本 + 明细（原 profile 不被修改） */
export function applyBackfillToProfile(
  profile: ResumeProfile,
  fields: FilledFieldSnapshot[],
  mappings: BackfillMapping[]
): BackfillApplyResult {
  const fieldById = new Map(fields.map((field) => [field.fieldId, field]))
  const updates: BackfillUpdate[] = []
  const conflicts: BackfillConflict[] = []
  let ignored = 0

  const working = JSON.parse(JSON.stringify(profile)) as ResumeProfile
  const claimedPaths = new Set<string>()

  for (const mapping of mappings) {
    const field = fieldById.get(mapping.fieldId)
    if (!field) {
      ignored += 1
      continue
    }

    const pageValue = String(field.value || '')
      .trim()
      .slice(0, PAGE_VALUE_WRITE_LIMIT)
    if (!pageValue || JUNK_VALUE_PATTERN.test(pageValue)) {
      ignored += 1
      continue
    }

    if (DERIVED_RESUME_PATHS.has(mapping.resumePath)) {
      ignored += 1
      continue
    }

    // 同一次回填中多个页面字段映射到同一简历字段：先到先得，后续忽略
    if (claimedPaths.has(mapping.resumePath)) {
      ignored += 1
      continue
    }

    const resumeValue = String(getValueByPath(profile, mapping.resumePath) ?? '').trim()
    if (resumeValue) {
      if (isEquivalentBackfillValue(resumeValue, pageValue)) {
        ignored += 1
      } else {
        conflicts.push({
          resumePath: mapping.resumePath,
          resumeValue: resumeValue.slice(0, 80),
          pageValue: pageValue.slice(0, 80),
          sourceLabel: field.label || mapping.fieldId,
        })
      }
      continue
    }

    claimedPaths.add(mapping.resumePath)
    setValueByPath(working as Record<string, unknown>, mapping.resumePath, pageValue)
    updates.push({
      resumePath: mapping.resumePath,
      value: pageValue,
      sourceLabel: field.label || mapping.fieldId,
      reason: mapping.reason,
    })
  }

  return { profile: working, result: { updates, conflicts, ignored } }
}

/** 解析 AI 返回文本 → 归一化映射 */
export function parseBackfillMappings(
  aiText: string,
  fields: FilledFieldSnapshot[]
): BackfillMapping[] {
  return normalizeBackfillMappings(parseJsonFromAiText(aiText), fields)
}
