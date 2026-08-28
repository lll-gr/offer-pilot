import { describe, expect, it } from 'vitest'

import type { OptionRuntime } from '../types'
import { getMatchScore, isAffirmative, matchesAnyCandidate, pickBestOption } from './match'

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

  it('pickBestRuntimeOption works for runtime options', () => {
    const options = [
      { el: {} as HTMLInputElement, label: '男', value: 'M' },
      { el: {} as HTMLInputElement, label: '女', value: 'F' },
    ] as OptionRuntime[]

    expect(pickBestOption(options, 'female')?.value).toBe('F')
  })
})
