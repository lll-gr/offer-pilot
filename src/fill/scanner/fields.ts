/**
 * 表单字段扫描：把 DOM 控件整理为 FieldDescriptor（发 AI）+ FieldRuntime（本地填充）。
 */

import type { FieldDescriptor, FieldRuntime, ScanResult } from '../types'
import { collectControls, isFillableElement, isVisible, isSkippableInputType } from './controls'
import { buildFieldSemanticMeta, getGroupLabel, getOptionLabel } from './labels'

const radioScopeIds = new WeakMap<object, string>()
let radioScopeSequence = 0

function getRadioScopeId(element: object | null | undefined): string {
  if (!element || (typeof element !== 'object' && typeof element !== 'function')) {
    return 'global'
  }

  if (!radioScopeIds.has(element)) {
    radioScopeSequence += 1
    radioScopeIds.set(element, `scope-${radioScopeSequence}`)
  }
  return radioScopeIds.get(element)!
}

function pickLikelyFormRoot(): ParentNode {
  const forms = Array.from(document.querySelectorAll('form')).filter((form) => isVisible(form))
  if (forms.length === 0) return document

  const ranked = forms
    .map((form) => ({ form, count: form.querySelectorAll('input,textarea,select').length }))
    .sort((left, right) => right.count - left.count)

  if (ranked[0]?.count >= 2) {
    return ranked[0].form
  }

  return document
}

function buildTextLikeRuntime(
  fieldId: string,
  el: HTMLInputElement,
  inputType: string,
  semanticMeta: ReturnType<typeof buildFieldSemanticMeta>
): FieldRuntime {
  return {
    fieldId,
    kind: 'text',
    inputType,
    el,
    readOnly: Boolean(el.readOnly || el.getAttribute('aria-readonly') === 'true'),
    label: semanticMeta?.label || '',
    placeholder: el.getAttribute('placeholder') || '',
    context: semanticMeta?.context || '',
    nearbyLabels: semanticMeta?.nearbyLabels || [],
    hasCalendarIcon: Boolean(
      el.closest?.(
        '[class*="picker"],[class*="Picker"],[class*="calendar"],[class*="Calendar"],[class*="date"],[class*="Date"]',
      ) || el.parentElement?.querySelector?.(".mtdicon-calendar-o,[class*='calendar']"),
    ),
  }
}

/**
 * 扫描页面（或选区）内的表单字段。
 * selectionRect 为视口坐标系矩形；提供时只保留与矩形相交的运行时字段。
 */
export function scanFields({ scope = 'page', selectionRect = null }: { scope?: 'page' | 'selection'; selectionRect?: SelectionRect | null } = {}): ScanResult {
  const root = scope === 'selection' ? document : pickLikelyFormRoot()
  const elements = collectControls(root)

  const fields: FieldDescriptor[] = []
  const runtime: FieldRuntime[] = []

  let idSeq = 0
  const radioGroups = new Map<string, { elements: HTMLInputElement[] } & ReturnType<typeof buildFieldSemanticMeta> & { name: string }>()
  const checkboxGroups = new Map<string, { elements: HTMLInputElement[] } & ReturnType<typeof buildFieldSemanticMeta> & { name: string }>()

  for (const el of elements) {
    if (!isFillableElement(el)) continue

    const tag = el.tagName.toLowerCase()
    const baseInputType = tag === 'input' ? String(el.getAttribute('type') || 'text').toLowerCase() : ''
    const semanticMeta = buildFieldSemanticMeta(el, {
      kind: tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text',
      inputType: baseInputType,
    })
    const commonMeta = {
      required: Boolean((el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true'),
      context: semanticMeta.context,
      sectionKey: semanticMeta.sectionKey,
      sectionLabel: semanticMeta.sectionLabel,
      sectionEvidence: semanticMeta.sectionEvidence,
      nearbyLabels: semanticMeta.nearbyLabels,
    }

    if (tag === 'select') {
      const fieldId = `f_${++idSeq}`
      const options = Array.from((el as HTMLSelectElement).options || [])
        .map((opt) => String(opt.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 60)

      fields.push({
        fieldId,
        kind: 'select',
        label: semanticMeta.label,
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: '',
        options,
        ...commonMeta,
      })

      runtime.push({ fieldId, kind: 'select', el })
      continue
    }

    if (tag === 'textarea') {
      const fieldId = `f_${++idSeq}`
      fields.push({
        fieldId,
        kind: 'textarea',
        label: semanticMeta.label,
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        options: [],
        ...commonMeta,
      })

      runtime.push({ fieldId, kind: 'textarea', el })
      continue
    }

    const isContentEditable =
      el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''
    if (isContentEditable) {
      const fieldId = `f_${++idSeq}`
      fields.push({
        fieldId,
        kind: 'contenteditable',
        label: semanticMeta.label,
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        options: [],
        ...commonMeta,
      })

      runtime.push({ fieldId, kind: 'contenteditable', el })
      continue
    }

    if (tag !== 'input') continue

    const type = baseInputType
    if (isSkippableInputType(type)) continue

    if (type === 'file') {
      const fieldId = `f_${++idSeq}`
      fields.push({
        fieldId,
        kind: 'file',
        label: semanticMeta.label,
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: '',
        inputType: type,
        options: [],
        ...commonMeta,
      })

      runtime.push({ fieldId, kind: 'file', inputType: type, el })
      continue
    }

    if (type === 'radio' || type === 'checkbox') {
      const input = el as HTMLInputElement
      const name = input.getAttribute('name') || input.id || ''
      const groupScope =
        input.closest?.('form, fieldset, [role="radiogroup"], [role="group"]') || input.parentElement || input
      const groupKey = `${type}:${getRadioScopeId(groupScope)}:${name || '(no-name)'}`
      const groupMap = type === 'radio' ? radioGroups : checkboxGroups

      if (!groupMap.has(groupKey)) {
        const groupMeta = buildFieldSemanticMeta(input, {
          kind: type === 'radio' ? 'radio_group' : 'checkbox_group',
          inputType: type,
        })
        groupMap.set(groupKey, {
          name,
          elements: [],
          label: groupMeta.label || getGroupLabel(input),
          context: groupMeta.context,
          sectionKey: groupMeta.sectionKey,
          sectionLabel: groupMeta.sectionLabel,
          sectionEvidence: groupMeta.sectionEvidence,
          nearbyLabels: groupMeta.nearbyLabels,
        })
      }

      groupMap.get(groupKey)!.elements.push(input)
      continue
    }

    const fieldId = `f_${++idSeq}`
    fields.push({
      fieldId,
      kind: 'text',
      inputType: type,
      label: semanticMeta.label,
      name: el.getAttribute('name') || '',
      id: el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      options: [],
      ...commonMeta,
    })

    runtime.push(buildTextLikeRuntime(fieldId, el as HTMLInputElement, type, semanticMeta))
  }

  for (const group of radioGroups.values()) {
    pushGroupField({ fields, runtime }, () => `f_${++idSeq}`, 'radio_group', group)
  }

  for (const group of checkboxGroups.values()) {
    pushGroupField({ fields, runtime }, () => `f_${++idSeq}`, 'checkbox_group', group)
  }

  if (scope === 'selection' && selectionRect) {
    const allowedFieldIds = new Set<string>()

    for (const item of runtime) {
      if (runtimeMatchesSelection(item, selectionRect)) {
        allowedFieldIds.add(item.fieldId)
      }
    }

    return {
      fields: fields.filter((field) => allowedFieldIds.has(field.fieldId)),
      runtime: runtime.filter((item) => allowedFieldIds.has(item.fieldId)),
    }
  }

  return { fields, runtime }
}

function pushGroupField(
  target: { fields: FieldDescriptor[]; runtime: FieldRuntime[] },
  nextId: () => string,
  kind: 'radio_group' | 'checkbox_group',
  group: { elements: HTMLInputElement[]; label: string; name: string; context: string; sectionKey: string; sectionLabel: string; sectionEvidence: string; nearbyLabels: string[] }
): void {
  const fieldId = nextId()
  const options = group.elements
    .map((input) => ({ label: getOptionLabel(input), value: input.value || '' }))
    .filter((item) => item.label || item.value)
    .slice(0, 80)

  target.fields.push({
    fieldId,
    kind,
    label: group.label,
    name: group.name,
    id: '',
    placeholder: '',
    options: options.map((item) => item.label || item.value),
    context: group.context,
    sectionKey: group.sectionKey,
    sectionLabel: group.sectionLabel,
    sectionEvidence: group.sectionEvidence,
    nearbyLabels: group.nearbyLabels,
    required: group.elements.some(
      (input) => input.required || input.getAttribute('aria-required') === 'true',
    ),
  })

  target.runtime.push({
    fieldId,
    kind,
    options: group.elements.map((input) => ({
      el: input,
      label: getOptionLabel(input) || input.value || '',
      value: input.value || '',
    })),
  })
}

// ---------------------------------------------------------------------------
// 选区几何
// ---------------------------------------------------------------------------

export interface ViewportRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type SelectionRect = ViewportRect

function rectFromDomRect(rect: DOMRect | null | undefined): ViewportRect | null {
  if (!rect) return null
  const width = Number(rect.width || 0)
  const height = Number(rect.height || 0)
  if (width <= 0 || height <= 0) return null

  return {
    left: Number(rect.left || 0),
    top: Number(rect.top || 0),
    right: Number(rect.right || 0),
    bottom: Number(rect.bottom || 0),
    width,
    height,
  }
}

function mergeRects(rects: ViewportRect[]): ViewportRect | null {
  if (!Array.isArray(rects) || rects.length === 0) return null

  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))

  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

export function rectsIntersect(leftRect: ViewportRect, rightRect: ViewportRect): boolean {
  if (!leftRect || !rightRect) return false
  return !(
    leftRect.right < rightRect.left ||
    leftRect.left > rightRect.right ||
    leftRect.bottom < rightRect.top ||
    leftRect.top > rightRect.bottom
  )
}

function getRuntimeViewportRect(runtime: FieldRuntime): ViewportRect | null {
  if (!runtime) return null

  if (runtime.el) {
    return rectFromDomRect(runtime.el.getBoundingClientRect())
  }

  if (Array.isArray(runtime.options) && runtime.options.length > 0) {
    const rects = runtime.options
      .map((option) => rectFromDomRect(option?.el?.getBoundingClientRect?.()))
      .filter(Boolean) as ViewportRect[]
    return mergeRects(rects)
  }

  return null
}

function runtimeMatchesSelection(runtime: FieldRuntime, selectionRect: SelectionRect): boolean {
  const runtimeRect = getRuntimeViewportRect(runtime)
  if (!runtimeRect) return false
  return rectsIntersect(runtimeRect, selectionRect)
}
