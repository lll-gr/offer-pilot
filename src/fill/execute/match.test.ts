import { describe, expect, it } from 'vitest'

import type { OptionRuntime } from '../types'
import { getMatchScore, isAffirmative, matchesAnyCandidate, normalizeOptionText, pickBestOption } from './match'

describe('option matching', () => {
  it('scores exact matches as 100', () => {
    expect(getMatchScore('本科', '本科')).toBe(100)
    expect(getMatchScore('bachelor', '本科')).toBe(100) // 别名组
  })

  it('scores containment for non-numeric labels', () => {
    expect(getMatchScore('统招全日制本科', '统招')).toBe(75)
  })

  it('avoids substring traps for short numeric values', () => {
    expect(getMatchScore('100人以内', '10')).toBe(50)
    expect(getMatchScore('2020届', '2020')).toBe(75) // 数字+单位后缀
  })

  it('pickBestOption prefers exact over fuzzy', () => {
    const option = pickBestOption(
      [
        { label: '统招专升本', value: 'upgrade' },
        { label: '全国普通高等院校全日制', value: 'fulltime' },
        { label: '全国普通高等院校非全日制', value: 'parttime' },
      ],
      '统招',
    )

    expect(option?.value).toBe('fulltime')
  })

  it('pickBestOption returns null for unmatched numerics', () => {
    const option = pickBestOption(
      [
        { label: '100人以内', value: 'lt100' },
        { label: '100-499人', value: '100to499' },
      ],
      '10',
    )

    expect(option).toBeNull()
  })

  it('pickBestOption keeps numeric unit suffix matches', () => {
    const option = pickBestOption(
      [
        { label: '2020届', value: '2020' },
        { label: '2021届', value: '2021' },
      ],
      '2020',
    )

    expect(option?.value).toBe('2020')
  })

  it('matchesAnyCandidate uses the 60 threshold', () => {
    expect(matchesAnyCandidate('英语', ['英语'])).toBe(true)
    expect(matchesAnyCandidate('100人以内', ['10'])).toBe(false)
  })

  it('isAffirmative detects yes-aliases', () => {
    expect(isAffirmative('是')).toBe(true)
    expect(isAffirmative('yes')).toBe(true)
    expect(isAffirmative('否')).toBe(false)
    expect(isAffirmative('')).toBe(false)
  })

  it('rewrites cross-language equivalences', () => {
    expect(normalizeOptionText('PRC')).toBe('中国')
    expect(normalizeOptionText('Chinese')).toBe('中国')
    expect(normalizeOptionText('中华人民共和国')).toBe('中国')
    expect(normalizeOptionText('至今')).toBe('present')
    expect(normalizeOptionText('硕士研究生')).toBe('硕士')
    expect(normalizeOptionText('大学本科')).toBe('本科')
  })

  it('matches cross-language nationality and present forms', () => {
    expect(getMatchScore('中国', 'PRC')).toBe(100)
    expect(getMatchScore('中国', 'Chinese')).toBe(100)
    expect(getMatchScore('至今', 'present')).toBe(100)
    expect(getMatchScore('2020至今', 'present')).toBe(75) // 复合选项包含
  })

  it('does not corrupt unmatched Chinese text', () => {
    expect(normalizeOptionText('中国科学院大学')).toBe('中国科学院大学')
    expect(getMatchScore('中国科学院大学', '中国科学院大学')).toBe(100)
  })

  it('rejects cross-group alias containment as pollution', () => {
    expect(getMatchScore('男', '女')).toBe(0) // male ⊂ female 不计分
    expect(getMatchScore('非全日制', '全日制')).toBe(0)
    expect(getMatchScore('统招全日制本科', '统招')).toBe(75) // 原文包含仍有效
  })

  it('pickBestRuntimeOption works for runtime options', () => {
    const options = [
      { el: {} as HTMLInputElement, label: '男', value: 'M' },
      { el: {} as HTMLInputElement, label: '女', value: 'F' },
    ] as OptionRuntime[]

    expect(pickBestOption(options, 'female')?.value).toBe('F')
  })
})
