import { describe, expect, it } from 'vitest'

import type { FieldRuntime } from '../types'
import { buildTextFallbackValues, hasExistingFieldValue } from './modes'

function textRuntime(overrides: Partial<FieldRuntime> = {}): FieldRuntime {
  return {
    fieldId: 'f_1',
    kind: 'text',
    label: '期望月薪',
    context: '请输入期望月薪（元）',
    ...overrides,
  }
}

describe('hasExistingFieldValue', () => {
  it('reads element value for text runtime', () => {
    expect(hasExistingFieldValue({ ...textRuntime(), el: { value: '已填' } as unknown as HTMLElement })).toBe(true)
    expect(hasExistingFieldValue({ ...textRuntime(), el: { value: '' } as unknown as HTMLElement })).toBe(false)
    expect(hasExistingFieldValue(undefined)).toBe(false)
  })

  it('checks selected state for option groups', () => {
    const checked = [{ el: { checked: true } as unknown as HTMLInputElement, label: 'a', value: 'a' }]
    const unchecked = [{ el: { checked: false } as unknown as HTMLInputElement, label: 'a', value: 'a' }]

    expect(
      hasExistingFieldValue({ fieldId: 'f', kind: 'radio_group', options: checked }),
    ).toBe(true)
    expect(
      hasExistingFieldValue({ fieldId: 'f', kind: 'checkbox_group', options: unchecked }),
    ).toBe(false)
  })

  it('checks selectedIndex for select runtime', () => {
    expect(
      hasExistingFieldValue({ fieldId: 'f', kind: 'select', el: { selectedIndex: 1, value: '' } as unknown as HTMLSelectElement }),
    ).toBe(true)
    expect(
      hasExistingFieldValue({ fieldId: 'f', kind: 'select', el: { selectedIndex: 0, value: '' } as unknown as HTMLSelectElement }),
    ).toBe(false)
  })

  it('checks textContent for contenteditable', () => {
    expect(
      hasExistingFieldValue({ fieldId: 'f', kind: 'contenteditable', el: { textContent: '内容' } as unknown as HTMLElement }),
    ).toBe(true)
  })

  it('checks files for file inputs', () => {
    expect(
      hasExistingFieldValue({ fieldId: 'f', kind: 'file', el: { files: [{}] } as unknown as HTMLInputElement }),
    ).toBe(true)
    expect(
      hasExistingFieldValue({ fieldId: 'f', kind: 'file', el: { files: [] } as unknown as HTMLInputElement }),
    ).toBe(false)
  })
})

describe('buildTextFallbackValues', () => {
  it('converts month salary ranges to numeric fallback', () => {
    const fallbacks = buildTextFallbackValues(textRuntime(), '10K-15K/月')

    expect(fallbacks).toEqual(['10000'])
  })

  it('converts to annual value for 年薪 fields', () => {
    // 月薪下限 10000 → 年薪 10000*12/10000 = 12（万）
    const fallbacks = buildTextFallbackValues(textRuntime({ label: '期望年薪' }), '10K-15K/月')

    expect(fallbacks).toEqual(['12'])
  })

  it('returns empty for non-salary runtimes', () => {
    expect(buildTextFallbackValues(textRuntime({ label: '姓名', context: '' }), '10K')).toEqual([])
    expect(buildTextFallbackValues(textRuntime(), '')).toEqual([])
  })
})
