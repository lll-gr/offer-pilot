/**
 * 结构化诊断日志格式化 + 敏感值脱敏。
 * 输出的行前缀（[扫描]/[映射:ai]/[取值]/[跳过]/[填充:成功]…）被
 * logs/visibility.ts 用于 UI 过滤，改动前需同步。
 */

export interface FillFieldLike {
  fieldId?: string
  kind?: string
  label?: string
  name?: string
  id?: string
  placeholder?: string
  sectionLabel?: string
  nearbyLabels?: string[]
  options?: string[]
  context?: string
}

export interface FillMappingLike {
  resumePath?: string
  reason?: string
  transform?: unknown
}

const DEFAULT_MAX_TEXT = 80
const DEFAULT_MAX_OPTIONS = 4

function compactText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateText(value: unknown, maxLength = DEFAULT_MAX_TEXT): string {
  const text = compactText(value)
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`
}

export function summarizeValue(value: unknown, { maxLength = DEFAULT_MAX_TEXT } = {}): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => compactText(item)).filter(Boolean).slice(0, 3)

    if (items.length === 0) {
      return '(empty)'
    }

    const suffix = value.length > items.length ? ', ...' : ''
    return `"${truncateText(items.join(', ') + suffix, maxLength)}"`
  }

  if (value && typeof value === 'object') {
    try {
      return `"${truncateText(JSON.stringify(value), maxLength)}"`
    } catch {
      return '"[object]"'
    }
  }

  const text = truncateText(value, maxLength)
  return text ? `"${text}"` : '(empty)'
}

export function summarizeOptions(options: unknown, { maxItems = DEFAULT_MAX_OPTIONS } = {}): string {
  const list = Array.isArray(options) ? options.map((item) => truncateText(item, 24)).filter(Boolean) : []

  if (list.length === 0) {
    return '[]'
  }

  const visible = list.slice(0, maxItems).join(' | ')
  const suffix = list.length > maxItems ? ' | ...' : ''
  return `[${visible}${suffix}]`
}

export function formatTransform(transform: unknown): string {
  if (!transform || typeof transform !== 'object') {
    return 'none'
  }

  const record = transform as Record<string, unknown>
  const type = compactText(record.type) || 'none'
  if (type === 'date_part' || type === 'phone_part') {
    const part = compactText(record.part)
    return part ? `${type}(${part})` : type
  }

  if (type === 'boolean_choice') {
    return `${type}(${compactText(record.trueValue) || 'true'}/${compactText(record.falseValue) || 'false'})`
  }

  if (type === 'join') {
    return `${type}(${compactText(record.separator) || ','})`
  }

  return type
}

export function isSensitiveField(field: FillFieldLike | null, mapping: FillMappingLike | null): boolean {
  const text = [field?.label, field?.name, field?.id, mapping?.resumePath]
    .map((item) => compactText(item))
    .join(' ')

  return /(姓名|名字|name|邮箱|email|手机|电话|phone|身份证|证件|护照|passport|地址|住址|微信|wechat|生日|出生|薪资|salary|简历|resume)/i.test(
    text,
  )
}

function summarizeLoggedValue(value: unknown, field: FillFieldLike | null, mapping: FillMappingLike | null): string {
  return isSensitiveField(field, mapping) ? '"[redacted]"' : summarizeValue(value)
}

export function formatFieldSummary(field: FillFieldLike): string {
  return [
    '[扫描]',
    compactText(field?.fieldId) || '(no-field-id)',
    compactText(field?.kind) || 'unknown',
    `label=${summarizeValue(field?.label)}`,
    `name=${summarizeValue(field?.name)}`,
    `id=${summarizeValue(field?.id)}`,
    `placeholder=${summarizeValue(field?.placeholder)}`,
    `section=${summarizeValue(field?.sectionLabel)}`,
    `nearby=${summarizeOptions(field?.nearbyLabels)}`,
    `options=${summarizeOptions(field?.options)}`,
    `context=${summarizeValue(field?.context, { maxLength: 120 })}`,
  ].join(' ')
}

export function formatMappingSummary(
  field: FillFieldLike,
  mapping: FillMappingLike,
  { source = 'ai' }: { source?: string } = {},
): string {
  return [
    `[映射:${compactText(source) || 'ai'}]`,
    compactText(field?.fieldId) || '(no-field-id)',
    `${summarizeValue(field?.label)} -> ${compactText(mapping?.resumePath) || '(unmapped)'}`,
    `transform=${formatTransform(mapping?.transform)}`,
    `reason=${summarizeValue(mapping?.reason, { maxLength: 120 })}`,
  ].join(' ')
}

export function formatValueSummary(
  field: FillFieldLike,
  mapping: FillMappingLike,
  rawValue: unknown,
  finalValue: unknown,
): string {
  return [
    '[取值]',
    compactText(field?.fieldId) || '(no-field-id)',
    compactText(mapping?.resumePath) || '(unmapped)',
    `raw=${summarizeLoggedValue(rawValue, field, mapping)}`,
    `final=${summarizeLoggedValue(finalValue, field, mapping)}`,
  ].join(' ')
}

export function formatSkipSummary(
  field: FillFieldLike,
  mapping: FillMappingLike | undefined,
  detail: unknown,
  rawValue: unknown,
  finalValue: unknown,
): string {
  return [
    '[跳过]',
    compactText(field?.fieldId) || '(no-field-id)',
    `${summarizeValue(field?.label)} -> ${compactText(mapping?.resumePath) || '(unmapped)'}`,
    `raw=${summarizeLoggedValue(rawValue, field, mapping ?? null)}`,
    `final=${summarizeLoggedValue(finalValue, field, mapping ?? null)}`,
    `detail=${summarizeValue(detail)}`,
  ].join(' ')
}

export function formatFillSummary({
  field,
  mapping,
  rawValue,
  finalValue,
  fillResult,
}: {
  field: FillFieldLike
  mapping: FillMappingLike
  rawValue: unknown
  finalValue: unknown
  fillResult: { filled?: boolean; message?: string }
}): string {
  const status = fillResult?.filled ? '成功' : '失败'
  return [
    `[填充:${status}]`,
    compactText(field?.fieldId) || '(no-field-id)',
    `${summarizeValue(field?.label)} -> ${compactText(mapping?.resumePath) || '(unmapped)'}`,
    `raw=${summarizeLoggedValue(rawValue, field, mapping)}`,
    `final=${summarizeLoggedValue(finalValue, field, mapping)}`,
    `detail=${summarizeValue(fillResult?.message)}`,
  ].join(' ')
}
