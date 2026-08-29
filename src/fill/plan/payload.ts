/**
 * AI 规划载荷构造与决策归一化（form_planning 模式）。
 */

import type { CatalogField } from '@/resume/schema'
import { getCatalogWithValues, getFieldCatalog } from '@/resume/schema'

import type { FieldAction, FieldConfidence, FieldDecision, FieldObservation, Transform } from '../types'
import { normalizeTransform } from '../execute/values'

export const FIELD_ACTIONS: FieldAction[] = ['fill', 'keep', 'correct', 'manual', 'skip']
export const FIELD_CONFIDENCES: FieldConfidence[] = ['high', 'medium', 'low']

export interface PlanningFieldPayload {
  fieldId: string
  kind: string
  label: string
  name: string
  id: string
  placeholder: string
  inputType: string
  options: string[]
  context: string
  sectionKey: string
  sectionLabel: string
  sectionEvidence: string
  nearbyLabels: string[]
  /** 当前已填值预览（空串=未填）：keep/correct 决策的直接依据 */
  currentValuePreview: string
  hasValue: boolean
}

export interface FieldPlanningPayload {
  url: string
  title: string
  allowedActions: FieldAction[]
  allowedConfidences: FieldConfidence[]
  allowedTransforms: Array<Record<string, string>>
  fields: PlanningFieldPayload[]
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

export function buildFieldPlanningPayload(
  observations: FieldObservation[],
  resumeProfile: Record<string, unknown>,
  { url, title }: { url: string; title: string }
): FieldPlanningPayload {
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

  const fields: PlanningFieldPayload[] = observations.map(({ descriptor, currentValue, hasValue }) => ({
    fieldId: descriptor.fieldId,
    kind: descriptor.kind,
    label: descriptor.label,
    name: descriptor.name,
    id: descriptor.id,
    placeholder: descriptor.placeholder,
    inputType: descriptor.inputType || '',
    options: descriptor.options || [],
    context: descriptor.context || '',
    sectionKey: descriptor.sectionKey || '',
    sectionLabel: descriptor.sectionLabel || '',
    sectionEvidence: descriptor.sectionEvidence || '',
    nearbyLabels: descriptor.nearbyLabels || [],
    currentValuePreview: currentValue,
    hasValue,
  }))

  return {
    url: sanitizePageUrl(url),
    title: String(title || '').slice(0, 120),
    allowedActions: FIELD_ACTIONS,
    allowedConfidences: FIELD_CONFIDENCES,
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

export interface RawDecision {
  fieldId?: unknown
  action?: unknown
  confidence?: unknown
  resumePath?: unknown
  reason?: unknown
  transform?: unknown
}

/**
 * 归一化 AI 返回：过滤未知 fieldId、校验 action 枚举与 resumePath 在 schema 目录内、
 * 规整 transform 与 confidence。action 缺失或非法时按「有映射=fill、无映射=skip」回退；
 * confidence 缺失或非法时按 medium 处理（只有明确的 low 才触发降级防线）。
 */
export function normalizeDecisions(
  rawDecisions: unknown,
  observations: FieldObservation[]
): FieldDecision[] {
  const validFieldIds = new Set(observations.map((observation) => String(observation.descriptor.fieldId)))
  const validResumePaths = new Set(
    getFieldCatalog({ mode: 'max' }).map((field) => field.path),
  )
  const validActions = new Set<string>(FIELD_ACTIONS)
  const validConfidences = new Set<string>(FIELD_CONFIDENCES)
  const normalized: FieldDecision[] = []

  for (const item of Array.isArray(rawDecisions) ? rawDecisions : []) {
    const raw = item as RawDecision
    const fieldId = String(raw?.fieldId || '').trim()
    if (!fieldId || !validFieldIds.has(fieldId)) continue

    const resumePath = String(raw?.resumePath || '').trim()
    const actionText = String(raw?.action || '').trim()
    const action = validActions.has(actionText)
      ? (actionText as FieldAction)
      : resumePath
        ? 'fill'
        : 'skip'

    const confidenceText = String(raw?.confidence || '').trim()

    normalized.push({
      fieldId,
      action,
      resumePath: resumePath && validResumePaths.has(resumePath) ? resumePath : '',
      reason: String(raw?.reason || '')
        .trim()
        .slice(0, 240),
      transform: normalizeTransform(raw?.transform) as Transform,
      confidence: validConfidences.has(confidenceText)
        ? (confidenceText as FieldConfidence)
        : 'medium',
    })
  }

  return normalized
}

export type { CatalogField }
