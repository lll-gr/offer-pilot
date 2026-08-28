/**
 * 填充运行时的值适配：只读日期控件识别、月精度偏好、写入校验。
 * 依赖 runtime 上的语义文本（label/placeholder/context/nearbyLabels）。
 */

export interface DateLikeRuntime {
  label?: string
  placeholder?: string
  context?: string
  nearbyLabels?: string[]
  readOnly?: boolean
  inputType?: string
  hasCalendarIcon?: boolean
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function collectRuntimeText(runtime: DateLikeRuntime | null | undefined): string {
  const parts = [
    runtime?.label,
    runtime?.placeholder,
    runtime?.context,
    ...(Array.isArray(runtime?.nearbyLabels) ? runtime.nearbyLabels : []),
  ]

  return parts.map((item) => normalizeText(item)).filter(Boolean).join(' ')
}

export function isReadonlyDateLikeRuntime(runtime: DateLikeRuntime | null | undefined): boolean {
  if (!runtime?.readOnly) return false
  if (runtime?.inputType && runtime.inputType !== 'text') return false

  const text = collectRuntimeText(runtime)
  if (!text) return Boolean(runtime?.hasCalendarIcon)

  const hasDateKeyword = /(入学|毕业|在校|开始|结束|时间|日期|date|month|calendar)/.test(text)

  return hasDateKeyword || Boolean(runtime?.hasCalendarIcon)
}

export function prefersMonthPrecision(runtime: DateLikeRuntime | null | undefined): boolean {
  const text = collectRuntimeText(runtime)
  return /(入学|毕业|在校|开始|结束|出生|年月|月份|月)/.test(text)
}

export function normalizeValueForRuntime(runtime: DateLikeRuntime | null | undefined, rawValue: string): string {
  const text = String(rawValue ?? '').trim()
  if (!text) return ''

  if (!isReadonlyDateLikeRuntime(runtime)) {
    return text
  }

  if (prefersMonthPrecision(runtime)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(text)) return text
    if (/^\d{4}$/.test(text)) return `${text}-01`
  }

  return text
}

export function matchesWrittenValue(
  runtime: DateLikeRuntime | null | undefined,
  actualValue: string,
  desiredValue: string,
): boolean {
  const actual = String(actualValue ?? '').trim()
  const desired = String(desiredValue ?? '').trim()
  if (!actual || !desired) return false

  if (isReadonlyDateLikeRuntime(runtime)) {
    if (actual === desired) return true
    if (/^\d{4}-\d{2}$/.test(desired) && actual.startsWith(desired)) return true
  }

  return actual === desired
}
