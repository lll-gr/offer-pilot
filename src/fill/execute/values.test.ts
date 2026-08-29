import { describe, expect, it } from 'vitest'

import {
  calculateTextSimilarity,
  cleanRuntimeText,
  deriveFillValue,
  hasMeaningfulFillValue,
  isLongTextSimilarEnough,
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

describe('long-text similarity', () => {
  const intro = '我是北京大学计算机专业的应届毕业生，熟练掌握 Python 与深度学习，曾在字节跳动实习参与推荐系统优化。'

  it('scores 1 for identical and 0.8 for containment', () => {
    expect(calculateTextSimilarity(intro, intro)).toBe(1)
    expect(calculateTextSimilarity(`前缀 ${intro} 后缀`, intro)).toBe(0.8)
  })

  it('ignores whitespace and case differences', () => {
    expect(calculateTextSimilarity(intro.replace(/，/g, ' ， '), intro)).toBe(1)
    expect(calculateTextSimilarity('Hello World From Offer Pilot', 'hello  world  from  offer pilot')).toBe(1)
  })

  it('gives low score to unrelated content', () => {
    expect(calculateTextSimilarity(intro, '今天天气很好，适合出去散步和爬山锻炼身体。')).toBeLessThan(0.3)
    expect(calculateTextSimilarity('', intro)).toBe(0)
  })

  it('applies threshold only to long texts', () => {
    expect(isLongTextSimilarEnough(intro.replace(/[\s，]/g, ''), intro)).toBe(true) // 规范化空白仍相似
    expect(isLongTextSimilarEnough('今天天气很好适合散步', intro)).toBe(false)
    expect(isLongTextSimilarEnough('张三', '李四')).toBe(false) // 短文本不适用
    expect(isLongTextSimilarEnough('张三', '张三')).toBe(false) // 短文本精确相等也不走该路径
  })
})
