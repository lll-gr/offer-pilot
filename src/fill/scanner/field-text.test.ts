import { describe, expect, it } from 'vitest'

import {
  isMeaningfulFieldText,
  normalizeFieldText,
  scoreFieldTextCandidate,
  selectBestFieldTextCandidate,
} from './field-text'

describe('field text helpers', () => {
  it('normalizes whitespace and trailing stars', () => {
    expect(normalizeFieldText('  姓名 * ')).toBe('姓名')
    expect(normalizeFieldText('姓名\n\n邮箱')).toBe('姓名 邮箱')
  })

  it('rejects non-meaningful candidates', () => {
    expect(isMeaningfulFieldText('')).toBe(false)
    expect(isMeaningfulFieldText('A')).toBe(false)
    expect(isMeaningfulFieldText('13800138000')).toBe(false)
    expect(isMeaningfulFieldText('邮箱')).toBe(true)
  })

  it('scores keyword labels above noise', () => {
    const label = scoreFieldTextCandidate('姓名：')
    expect(label).toBeGreaterThan(scoreFieldTextCandidate('13800138000'))
    // 日期区间噪声被明显降权（带空格形式触发区间扣分）
    expect(scoreFieldTextCandidate('1998 年 6 月 至 2005 年 6 月')).toBeLessThan(label)
    expect(scoreFieldTextCandidate('姓名：邮箱：')).toBeLessThan(label)
  })

  it('selects the best candidate', () => {
    expect(selectBestFieldTextCandidate(['13800138000', '电子邮箱：', 'xxx'])).toBe('电子邮箱：')
    expect(selectBestFieldTextCandidate([])).toBe('')
  })
})
