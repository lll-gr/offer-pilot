import { describe, expect, it } from 'vitest'

import {
  cleanRuntimeText,
  deriveFillValue,
  hasMeaningfulFillValue,
  normalizeCheckboxCandidates,
  normalizeTransform,
  prepareTextValueForRuntime,
} from './values'

describe('transform normalization', () => {
  it('defaults to none', () => {
    expect(normalizeTransform(null)).toEqual({ type: 'none' })
    expect(normalizeTransform('garbage')).toEqual({ type: 'none' })
    expect(normalizeTransform({ type: 'unknown' })).toEqual({ type: 'none' })
  })

  it('normalizes known transforms with clamped fields', () => {
    expect(normalizeTransform({ type: 'date_part', part: 'month' })).toEqual({ type: 'date_part', part: 'month' })
    expect(normalizeTransform({ type: 'date_part', part: 'week' })).toEqual({ type: 'date_part', part: 'year' })
    expect(normalizeTransform({ type: 'phone_part', part: 'countryCode' })).toEqual({
      type: 'phone_part',
      part: 'countryCode',
    })
    expect(normalizeTransform({ type: 'boolean_choice' })).toEqual({
      type: 'boolean_choice',
      trueValue: 'Yes',
      falseValue: 'No',
    })
    expect(normalizeTransform({ type: 'join', separator: '、' })).toEqual({ type: 'join', separator: '、' })
  })
})

describe('deriveFillValue', () => {
  it('returns empty when source is empty', () => {
    expect(deriveFillValue('', { type: 'none' })).toBe('')
    expect(deriveFillValue(['  '], { type: 'none' })).toBe('')
  })

  it('extracts date parts', () => {
    expect(deriveFillValue('2024-06-15', { type: 'date_part', part: 'year' })).toBe('2024')
    expect(deriveFillValue('2024-06-15', { type: 'date_part', part: 'month' })).toBe('06')
    expect(deriveFillValue('2024-06-15', { type: 'date_part', part: 'day' })).toBe('15')
    expect(deriveFillValue('2024-06', { type: 'date_part', part: 'day' })).toBe('')
  })

  it('splits phone parts', () => {
    expect(deriveFillValue('+86 13800138000', { type: 'phone_part', part: 'countryCode' })).toBe('+86')
    expect(deriveFillValue('+86 13800138000', { type: 'phone_part', part: 'nationalNumber' })).toBe('13800138000')
  })

  it('maps boolean choices through aliases', () => {
    expect(deriveFillValue('是', { type: 'boolean_choice', trueValue: '有', falseValue: '无' })).toBe('有')
    expect(deriveFillValue('no', { type: 'boolean_choice', trueValue: '有', falseValue: '无' })).toBe('无')
  })

  it('joins arrays', () => {
    expect(deriveFillValue(['React', 'Vue'], { type: 'join', separator: ', ' })).toBe('React, Vue')
  })

  it('splits checkbox candidates for checkbox_group runtime', () => {
    const runtime = { kind: 'checkbox_group' as const, fieldId: 'f_1' }
    expect(deriveFillValue('React, Vue; Node', { type: 'none' }, runtime)).toEqual(['React', 'Vue', 'Node'])
  })
})

describe('normalizeCheckboxCandidates', () => {
  it('splits on common separators', () => {
    expect(normalizeCheckboxCandidates('a,b，c;d\ne')).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(normalizeCheckboxCandidates(['x', ' y '])).toEqual(['x', 'y'])
    expect(normalizeCheckboxCandidates('')).toEqual([])
  })
})

describe('prepareTextValueForRuntime', () => {
  it('joins array values', () => {
    expect(prepareTextValueForRuntime(undefined, ['a', 'b'])).toBe('a, b')
  })

  it('adapts date input formats', () => {
    const dateRuntime = { fieldId: 'f', kind: 'text' as const, inputType: 'date' }
    expect(prepareTextValueForRuntime(dateRuntime, '2024-06')).toBe('2024-06-01')
    expect(prepareTextValueForRuntime(dateRuntime, '2024')).toBe('2024-01-01')
    expect(prepareTextValueForRuntime(dateRuntime, '2024-06-15')).toBe('2024-06-15')
    expect(prepareTextValueForRuntime(dateRuntime, '今年')).toBe('')
  })

  it('adapts month input formats', () => {
    const monthRuntime = { fieldId: 'f', kind: 'text' as const, inputType: 'month' }
    expect(prepareTextValueForRuntime(monthRuntime, '2024-06-15')).toBe('2024-06')
    expect(prepareTextValueForRuntime(monthRuntime, '2024')).toBe('2024-01')
  })
})

describe('cleanRuntimeText', () => {
  it('strips +86 prefix on tel inputs and phone-like labels', () => {
    expect(cleanRuntimeText({ fieldId: 'f', kind: 'text', inputType: 'tel' }, '+86 13800138000')).toBe('13800138000')
    expect(cleanRuntimeText({ fieldId: 'f', kind: 'text', label: '手机号码' }, '+86-13800138000')).toBe('13800138000')
    expect(cleanRuntimeText({ fieldId: 'f', kind: 'text', label: '手机号码' }, '8613800138000')).toBe('13800138000')
  })

  it('strips height/weight unit suffixes', () => {
    expect(cleanRuntimeText({ fieldId: 'f', kind: 'text', label: '身高' }, '170cm')).toBe('170')
    expect(cleanRuntimeText({ fieldId: 'f', kind: 'text', label: '体重' }, '60千克')).toBe('60')
    expect(cleanRuntimeText({ fieldId: 'f', kind: 'text', label: '体重' }, '60 公斤')).toBe('60')
  })

  it('keeps values untouched on unrelated fields', () => {
    expect(cleanRuntimeText({ fieldId: 'f', kind: 'text', label: '姓名' }, '张三')).toBe('张三')
    expect(cleanRuntimeText({ fieldId: 'f', kind: 'text', label: '学校' }, '86中学')).toBe('86中学')
    expect(cleanRuntimeText(undefined, '+86 13800138000')).toBe('+86 13800138000')
  })

  it('integrates with prepareTextValueForRuntime for tel inputs', () => {
    expect(prepareTextValueForRuntime({ fieldId: 'f', kind: 'text', inputType: 'tel' }, '+86 13800138000')).toBe(
      '13800138000',
    )
  })
})

describe('hasMeaningfulFillValue', () => {
  it('accepts non-empty strings and arrays', () => {
    expect(hasMeaningfulFillValue('x')).toBe(true)
    expect(hasMeaningfulFillValue(['x'])).toBe(true)
    expect(hasMeaningfulFillValue('')).toBe(false)
    expect(hasMeaningfulFillValue([])).toBe(false)
  })
})
