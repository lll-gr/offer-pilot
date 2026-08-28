import { describe, expect, it } from 'vitest'

import {
  formatFieldSummary,
  formatMappingSummary,
  formatSkipSummary,
  formatValueSummary,
  isSensitiveField,
  summarizeOptions,
  summarizeValue,
} from './diagnostics'
import { shouldRenderLogInUi } from './visibility'

describe('diagnostics formatting', () => {
  it('summarizes values with truncation', () => {
    expect(summarizeValue('')).toBe('(empty)')
    expect(summarizeValue('abc')).toBe('"abc"')
    expect(summarizeValue(['a', 'b', 'c', 'd'])).toBe('"a, b, c, ..."')
    expect(summarizeValue('x'.repeat(100), { maxLength: 20 })).toBe(`"${'x'.repeat(17)}..."`)
  })

  it('summarizes option lists compactly', () => {
    expect(summarizeOptions([])).toBe('[]')
    expect(summarizeOptions(['a', 'b'])).toBe('[a | b]')
    expect(summarizeOptions(['a', 'b', 'c', 'd', 'e'])).toBe('[a | b | c | d | ...]')
  })

  it('formats a field summary line', () => {
    const line = formatFieldSummary({
      fieldId: 'f_1',
      kind: 'text',
      label: '姓名',
      name: 'name',
      id: '',
      placeholder: '',
      sectionLabel: '基本信息',
      nearbyLabels: ['邮箱'],
      options: [],
      context: '基本信息',
    })

    expect(line).toContain('[扫描]')
    expect(line).toContain('f_1')
    expect(line).toContain('label="姓名"')
    expect(line).toContain('section="基本信息"')
  })

  it('formats mapping and value lines', () => {
    const mapping = formatMappingSummary(
      { fieldId: 'f_2', label: '邮箱' },
      { resumePath: 'personal.email', reason: '邮箱字段', transform: { type: 'none' } },
    )
    expect(mapping).toContain('[映射:ai]')
    expect(mapping).toContain('"邮箱" -> personal.email')

    const value = formatValueSummary({ fieldId: 'f_2' }, { resumePath: 'personal.email' }, 'a@b.c', 'a@b.c')
    expect(value).toContain('[取值]')
  })

  it('redacts sensitive values in logs', () => {
    expect(isSensitiveField({ label: '手机号码' }, {})).toBe(true)
    expect(isSensitiveField({ label: '城市' }, {})).toBe(false)

    const line = formatValueSummary(
      { fieldId: 'f_1', label: '手机号码' },
      { resumePath: 'personal.phoneNumber' },
      '13800138000',
      '13800138000',
    )
    expect(line).toContain('"[redacted]"')
    expect(line).not.toContain('13800138000')
  })

  it('formats skip summaries with detail', () => {
    const line = formatSkipSummary(
      { fieldId: 'f_1', label: '描述' },
      { resumePath: '' },
      '字段已有内容，增量模式下不覆盖',
      '',
      '',
    )

    expect(line).toContain('[跳过]')
    expect(line).toContain('字段已有内容')
  })
})

describe('log visibility', () => {
  it('hides verbose structured diagnostics in the UI', () => {
    expect(shouldRenderLogInUi('info', '[扫描] f_1 ...')).toBe(false)
    expect(shouldRenderLogInUi('info', '[映射:cache] f_1 ...')).toBe(false)
    expect(shouldRenderLogInUi('info', '[取值] f_1 ...')).toBe(false)
  })

  it('shows fill failures and flow messages', () => {
    expect(shouldRenderLogInUi('warning', '[填充:失败] f_1 ...')).toBe(true)
    expect(shouldRenderLogInUi('success', '填充完成')).toBe(true)
    expect(shouldRenderLogInUi('info', '')).toBe(false)
  })
})
