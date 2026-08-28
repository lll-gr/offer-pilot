/**
 * AI 映射载荷构造与结果归一化。
 */

import type { CatalogField } from '@/resume/schema'
import { getCatalogWithValues, getFieldCatalog } from '@/resume/schema'

import type { FieldDescriptor, FieldMapping, Transform } from '../types'
import { normalizeTransform } from '../filler/values'

export interface FieldMappingPayload {
  url: string
  title: string
  allowedTransforms: Array<Record<string, string>>
  fields: FieldDescriptor[]
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

export function sanitizePageUrl(value: string): string {
  const rawUrl = String(value || '')
  if (typeof URL !== 'function') {
    return rawUrl.split(/[?#]/, 1)[0]
  }

  try {
    const url = new URL(rawUrl)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return rawUrl.split(/[?#]/, 1)[0]
  }
}

export function buildFieldMappingPayload(
  fields: FieldDescriptor[],
  resumeProfile: Record<string, unknown>,
  { url, title }: { url: string; title: string }
): FieldMappingPayload {
  const resumeFields = getCatalogWithValues(resumeProfile as Parameters<typeof getCatalogWithValues>[0])
    .filter((field) => field.hasValue)
    .map((field) => ({
      path: field.path,
      label: field.label,
      sectionLabel: field.sectionLabel,
      itemLabel: field.itemLabel || '',
      input: field.input,
      hasValue: Boolean(field.hasValue),
      valuePreview: field.valuePreview || '',
      options: field.options || [],
    }))

  return {
    url: sanitizePageUrl(url),
    title: String(title || '').slice(0, 120),
    allowedTransforms: [
      { type: 'none' },
      { type: 'date_part', part: 'year|month|day' },
      { type: 'phone_part', part: 'countryCode|nationalNumber' },
      { type: 'boolean_choice', trueValue: 'text', falseValue: 'text' },
      { type: 'join', separator: ', ' },
    ],
    fields,
    resumeFields,
  }
}

export interface RawMapping {
  fieldId?: unknown
  resumePath?: unknown
  reason?: unknown
  transform?: unknown
}

/** 归一化 AI 返回：过滤未知 fieldId、校验 resumePath 在 schema 目录内、规整 transform */
export function normalizeMappings(rawMappings: unknown, fields: FieldDescriptor[]): FieldMapping[] {
  const validFieldIds = new Set(fields.map((field) => String(field.fieldId)))
  const validResumePaths = new Set(
    getFieldCatalog({ mode: 'max' }).map((field) => field.path),
  )
  const normalized: FieldMapping[] = []

  for (const item of Array.isArray(rawMappings) ? rawMappings : []) {
    const fieldId = String((item as RawMapping)?.fieldId || '').trim()
    if (!fieldId || !validFieldIds.has(fieldId)) continue

    const resumePath = String((item as RawMapping)?.resumePath || '').trim()
    normalized.push({
      fieldId,
      resumePath: resumePath && validResumePaths.has(resumePath) ? resumePath : '',
      reason: String((item as RawMapping)?.reason || '')
        .trim()
        .slice(0, 240),
      transform: normalizeTransform((item as RawMapping)?.transform) as Transform,
    })
  }

  return normalized
}

export type { CatalogField }
