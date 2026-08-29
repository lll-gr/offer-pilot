/**
 * 观察层：descriptor + runtime → FieldObservation。
 * 读取字段当前值快照，供规划层判断 keep/correct 与诊断日志展示。
 */

import { readCustomSelectDisplay } from './execute/custom-select'
import { hasExistingFieldValue } from './execute/modes'
import type { FieldDescriptor, FieldObservation, FieldRuntime } from './types'

const PREVIEW_LIMIT = 40

/** 各控件类型的当前值预览（select 为选中项文本，radio/checkbox 为已勾选项） */
export function readFieldValuePreview(runtime: FieldRuntime | undefined): string {
  if (!runtime) return ''

  if (runtime.kind === 'radio_group' || runtime.kind === 'checkbox_group') {
    return (runtime.options || [])
      .filter((option) => Boolean(option?.el?.checked))
      .map((option) => option.label || option.value)
      .filter(Boolean)
      .join(', ')
  }

  if (runtime.kind === 'select') {
    const el = runtime.el as HTMLSelectElement
    const index = Number(el?.selectedIndex ?? -1)
    // index=0 且 value 空通常占位项（「请选择」），与 hasExistingFieldValue 口径一致视为未填
    const isPlaceholderOption = index === 0 && !String(el?.value ?? '').trim()
    if (isPlaceholderOption) return ''
    return String(el?.options?.[index]?.textContent ?? '').trim()
  }

  if (runtime.kind === 'custom_select') {
    return readCustomSelectDisplay(runtime.el as HTMLElement | undefined)
  }

  if (runtime.kind === 'contenteditable') {
    return String((runtime.el as HTMLElement)?.textContent ?? '').trim()
  }

  if (runtime.kind === 'file') return ''

  return String((runtime.el as HTMLInputElement)?.value ?? '').trim()
}

export function observeField(
  descriptor: FieldDescriptor,
  runtime: FieldRuntime | undefined
): FieldObservation {
  const currentValue = readFieldValuePreview(runtime)
  return {
    descriptor,
    runtime,
    currentValue:
      currentValue.length > PREVIEW_LIMIT ? `${currentValue.slice(0, PREVIEW_LIMIT)}...` : currentValue,
    hasValue: hasExistingFieldValue(runtime),
  }
}

export function observeFields(
  fields: FieldDescriptor[],
  runtimeMap: Map<string, FieldRuntime>
): FieldObservation[] {
  return fields.map((field) => observeField(field, runtimeMap.get(field.fieldId)))
}
