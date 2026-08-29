/**
 * 填充模式辅助：已有值检测（增量模式跳过）、薪资回退值。
 * 控件分发已迁移至 strategies.ts 的 FILL_STRATEGIES 注册表。
 */

import type { FieldRuntime } from '../types'
import { readCustomSelectDisplay } from './custom-select'

/** 该字段当前是否已有用户内容（增量模式下跳过） */
export function hasExistingFieldValue(runtime: FieldRuntime | undefined): boolean {
  if (!runtime) return false

  if (runtime.kind === 'checkbox_group' || runtime.kind === 'radio_group') {
    return (runtime.options || []).some((option) => Boolean(option?.el?.checked))
  }

  if (runtime.kind === 'select') {
    const el = runtime.el as HTMLSelectElement
    const selectedIndex = Number(el?.selectedIndex ?? -1)
    const value = String(el?.value ?? '').trim()
    if (!value) return selectedIndex > 0
    return true
  }

  if (runtime.kind === 'custom_select') {
    return Boolean(readCustomSelectDisplay(runtime.el as HTMLElement | undefined))
  }

  if (runtime.kind === 'contenteditable') {
    return Boolean(String((runtime.el as HTMLElement)?.textContent || '').trim())
  }

  if (runtime.kind === 'file') {
    return Boolean((runtime.el as HTMLInputElement)?.files?.length)
  }

  return Boolean(String((runtime.el as HTMLInputElement).value ?? '').trim())
}

function collectRuntimeText(runtime: FieldRuntime): string {
  const parts = [
    runtime?.label,
    runtime?.placeholder,
    runtime?.context,
    ...(Array.isArray(runtime?.nearbyLabels) ? runtime.nearbyLabels : []),
  ]
  return parts.map((item) => String(item || '')).join(' ')
}

function isSalaryLikeRuntime(runtime: FieldRuntime): boolean {
  const text = collectRuntimeText(runtime)
  return /(薪资|薪酬|月薪|年薪|salary|compensation)/i.test(text)
}

interface SalaryParseResult {
  monthlyLower: number
}

function parseSalaryValue(value: string): SalaryParseResult {
  const text = String(value || '')
    .replace(/[,\s]/g, '')
    .trim()
  if (!text) {
    return { monthlyLower: 0 }
  }

  const numbers = Array.from(text.matchAll(/\d+(?:\.\d+)?/g)).map((match) => Number(match[0]))
  if (numbers.length === 0) {
    return { monthlyLower: 0 }
  }

  let multiplier = 1
  if (/[kK千]/.test(text)) {
    multiplier = 1000
  } else if (/[wW万]/.test(text)) {
    multiplier = 10000
  }

  let monthlyLower = Math.round(numbers[0] * multiplier)
  if (/年/.test(text) && !/月/.test(text)) {
    monthlyLower = Math.round(monthlyLower / 12)
  }

  return { monthlyLower }
}

function getSalaryFallbackValue(runtime: FieldRuntime, value: string): string {
  const parsed = parseSalaryValue(value)
  if (!parsed.monthlyLower) {
    return ''
  }

  const runtimeText = collectRuntimeText(runtime)

  if (/年薪|万/.test(runtimeText)) {
    return String(Math.max(1, Math.round((parsed.monthlyLower * 12) / 10000)))
  }

  return String(parsed.monthlyLower)
}

export function buildTextFallbackValues(runtime: FieldRuntime, desired: string): string[] {
  const text = String(desired || '').trim()
  if (!text || !isSalaryLikeRuntime(runtime)) {
    return []
  }

  const fallback = getSalaryFallbackValue(runtime, text)
  if (!fallback || fallback === text) {
    return []
  }

  return [fallback]
}
