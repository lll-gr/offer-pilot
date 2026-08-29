/**
 * 填充值派生：resumePath 原始值 + AI transform → 最终写入值。
 * 纯函数，无 DOM 依赖。
 */

import type { FieldRuntime, Transform } from '../types'
import { isAffirmative } from './match'

export function normalizeTransform(transform: unknown): Transform {
  if (!transform || typeof transform !== 'object') {
    return { type: 'none' }
  }

  const record = transform as Record<string, unknown>
  const type = String(record.type || 'none').trim()

  if (type === 'date_part') {
    const part = ['year', 'month', 'day'].includes(String(record.part)) ? (record.part as 'year' | 'month' | 'day') : 'year'
    return { type, part }
  }

  if (type === 'phone_part') {
    const part = record.part === 'countryCode' ? 'countryCode' : 'nationalNumber'
    return { type, part }
  }

  if (type === 'boolean_choice') {
    return {
      type,
      trueValue: String(record.trueValue ?? 'Yes'),
      falseValue: String(record.falseValue ?? 'No'),
    }
  }

  if (type === 'join') {
    return {
      type,
      separator: String(record.separator || ', '),
    }
  }

  return { type: 'none' }
}

function hasSourceValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => String(item || '').trim())
  }

  return String(value ?? '').trim().length > 0
}

export function normalizeCheckboxCandidates(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean)
  }

  const text = String(value || '').trim()
  if (!text) return []

  return text
    .split(/[\n,，;/]/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function hasMeaningfulFillValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => String(item || '').trim())
  }

  return String(value ?? '').trim().length > 0
}

/**
 * 长文本相似度（0-1）：containment 记 0.8；否则取字符重叠与（拉丁文）词重叠的最大值。
 * 用于自我介绍类 textarea 写入后的宽松校验——框架常规范化空白/换行导致精确比对失败，
 * 完全不同的内容仍会被拦下。仅适用于长文本（短字段必须精确匹配）。
 */
export function calculateTextSimilarity(actual: string, expected: string): number {
  const left = String(actual ?? '').toLowerCase().replace(/\s+/g, '')
  const right = String(expected ?? '').toLowerCase().replace(/\s+/g, '')
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.8

  const leftChars = new Set(left)
  const rightChars = new Set(right)
  const charOverlap =
    leftChars.size === 0 || rightChars.size === 0
      ? 0
      : [...leftChars].filter((char) => rightChars.has(char)).length /
        new Set([...leftChars, ...rightChars]).size

  const leftWords = new Set(left.split(/[^a-z0-9]+/).filter(Boolean))
  const rightWords = new Set(right.split(/[^a-z0-9]+/).filter(Boolean))
  const wordOverlap =
    leftWords.size === 0 || rightWords.size === 0
      ? 0
      : [...leftWords].filter((word) => rightWords.has(word)).length /
        new Set([...leftWords, ...rightWords]).size

  return Math.max(charOverlap, wordOverlap)
}

/** 长文本宽松校验阈值：低于该值视为写入失败 */
export const LONG_TEXT_SIMILARITY_THRESHOLD = 0.3

/** 长文本（≥10 字符）写入后的相似度判定；短文本不适用（须精确匹配） */
export function isLongTextSimilarEnough(actual: string, expected: string): boolean {
  const left = String(actual ?? '').trim()
  const right = String(expected ?? '').trim()
  if (left.length < 10 || right.length < 10) return false
  return calculateTextSimilarity(left, right) >= LONG_TEXT_SIMILARITY_THRESHOLD
}

function getDatePart(value: unknown, part: 'year' | 'month' | 'day'): string {
  const text = String(value || '').trim()
  if (!text) return ''

  const match = text.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/)
  if (!match) return ''

  if (part === 'year') return match[1] || ''
  if (part === 'month') return match[2] ? match[2].padStart(2, '0') : ''
  return match[3] ? match[3].padStart(2, '0') : ''
}

function getPhonePart(value: unknown, part: 'countryCode' | 'nationalNumber'): string {
  const text = String(value || '').trim()
  if (!text) return ''

  if (part === 'countryCode') {
    const match = text.match(/^\+?\d{1,4}/)
    return match ? match[0] : ''
  }

  return text.replace(/^\+?\d{1,4}[\s-]*/, '').trim()
}

function joinValue(value: unknown, separator: string): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean).join(separator)
  }

  return String(value || '').trim()
}

/** resume 原始值 + transform → 待写入值（可能为 string 或 string[]） */
export function deriveFillValue(rawValue: unknown, transform: unknown, runtime?: FieldRuntime): string | string[] {
  if (!hasSourceValue(rawValue)) {
    return ''
  }

  const normalizedTransform = normalizeTransform(transform)

  if (normalizedTransform.type === 'date_part') {
    return getDatePart(rawValue, normalizedTransform.part)
  }

  if (normalizedTransform.type === 'phone_part') {
    return getPhonePart(rawValue, normalizedTransform.part)
  }

  if (normalizedTransform.type === 'boolean_choice') {
    return isAffirmative(rawValue) ? normalizedTransform.trueValue : normalizedTransform.falseValue
  }

  if (normalizedTransform.type === 'join') {
    return joinValue(rawValue, normalizedTransform.separator)
  }

  if (runtime?.kind === 'checkbox_group') {
    return normalizeCheckboxCandidates(rawValue)
  }

  return rawValue as string
}

/** text 类运行时的最终写入值：数组拍平 + 日期格式适配 */
export function prepareTextValueForRuntime(runtime: FieldRuntime | undefined, value: string | string[]): string {
  let text = Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).join(', ')
    : String(value ?? '').trim()

  if (!text) return ''

  text = normalizeRuntimeText(runtime, text)
  if (!text) return ''

  if (runtime?.inputType === 'date') {
    if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`
    if (/^\d{4}$/.test(text)) return `${text}-01-01`
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
    return ''
  }

  if (runtime?.inputType === 'month') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(text)) return text
    if (/^\d{4}$/.test(text)) return `${text}-01`
    return ''
  }

  return text
}

function normalizeRuntimeText(runtime: FieldRuntime | undefined, rawValue: string): string {
  return cleanRuntimeText(runtime, rawValue)
}

function collectRuntimeText(runtime: FieldRuntime | undefined): string {
  const parts = [
    runtime?.label,
    runtime?.placeholder,
    runtime?.context,
    ...(Array.isArray(runtime?.nearbyLabels) ? runtime.nearbyLabels : []),
  ]
  return parts.map((item) => String(item || '')).join(' ')
}

/** 电话类字段剥 +86 国家码前缀；身高/体重剥单位后缀 */
export function cleanRuntimeText(runtime: FieldRuntime | undefined, value: string): string {
  let text = String(value ?? '').trim()
  if (!text || !runtime) return text

  const runtimeText = collectRuntimeText(runtime)

  const isPhoneLike =
    runtime.inputType === 'tel' || /(手机|电话|联系方式|phone|tel|mobile)/i.test(runtimeText)
  if (isPhoneLike) {
    return text.replace(/^\+?86[\s-]*/, '')
  }

  if (/(身高|体重|height|weight|cm|kg)/i.test(runtimeText)) {
    return text.replace(/(cm|厘米|kg|千克|公斤)\s*$/i, '').trim()
  }

  return text
}
