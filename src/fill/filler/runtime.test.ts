import { describe, expect, it } from 'vitest'

import { isReadonlyDateLikeRuntime, matchesWrittenValue, normalizeValueForRuntime } from './runtime'

describe('fill runtime', () => {
  it('identifies readonly date-like runtimes', () => {
    expect(isReadonlyDateLikeRuntime({ readOnly: true, label: '入学时间' })).toBe(true)
    expect(isReadonlyDateLikeRuntime({ readOnly: true, label: '期望薪资' })).toBe(false)
    expect(isReadonlyDateLikeRuntime({ readOnly: true, hasCalendarIcon: true })).toBe(true)
    expect(isReadonlyDateLikeRuntime({ readOnly: false, label: '入学时间' })).toBe(false)
    expect(isReadonlyDateLikeRuntime({ readOnly: true, inputType: 'date' })).toBe(false)
  })

  it('truncates to month precision when the field prefers months', () => {
    const runtime = { readOnly: true, label: '毕业时间' }

    expect(normalizeValueForRuntime(runtime, '2024-06-15')).toBe('2024-06')
    expect(normalizeValueForRuntime(runtime, '2024-06')).toBe('2024-06')
    expect(normalizeValueForRuntime(runtime, '2024')).toBe('2024-01')
  })

  it('keeps full value when month precision is not preferred', () => {
    const runtime = { readOnly: true, label: '日期' }

    expect(normalizeValueForRuntime(runtime, '2024-06-15')).toBe('2024-06-15')
  })

  it('validates written values with month-prefix tolerance', () => {
    const runtime = { readOnly: true, label: '入学时间' }

    expect(matchesWrittenValue(runtime, '2024-06-01', '2024-06')).toBe(true)
    expect(matchesWrittenValue(runtime, '2024-07-01', '2024-06')).toBe(false)
    expect(matchesWrittenValue(runtime, '', '2024-06')).toBe(false)
    expect(matchesWrittenValue({ label: '姓名' }, '张三', '张三')).toBe(true)
  })
})
