import { describe, expect, it } from 'vitest'

import { matchYearText, parseDateParts, readDisplayedDateValue } from './date-panel'

describe('parseDateParts', () => {
  it('parses year-month and year-month-day', () => {
    expect(parseDateParts('2020-08')).toEqual({ year: 2020, month: 8, day: 0 })
    expect(parseDateParts('2020-08-15')).toEqual({ year: 2020, month: 8, day: 15 })
  })

  it('returns zeros for non-canonical input', () => {
    expect(parseDateParts('2020年8月')).toEqual({ year: 0, month: 0, day: 0 })
    expect(parseDateParts('')).toEqual({ year: 0, month: 0, day: 0 })
  })
})

describe('matchYearText', () => {
  it('matches year with unit, bare year, and year-month header', () => {
    expect(matchYearText('2020年')).toBe(2020)
    expect(matchYearText('2020年8月')).toBe(2020)
    expect(matchYearText('2020')).toBe(2020)
  })

  it('rejects day cells and non-year text', () => {
    expect(matchYearText('15')).toBeNull()
    expect(matchYearText('2020 - 2030')).toBeNull()
    expect(matchYearText('出生日期')).toBeNull()
  })
})

describe('readDisplayedDateValue', () => {
  function fakeInput({ value = '', wrapperText = '' }: { value?: string; wrapperText?: string } = {}) {
    const wrapper = { textContent: wrapperText }
    return {
      value,
      closest: () => wrapper,
    } as unknown as HTMLInputElement
  }

  it('prefers the input value when present', () => {
    expect(readDisplayedDateValue(fakeInput({ value: '2020-08-15' }))).toBe('2020-08-15')
  })

  it('falls back to wrapper text and canonicalizes formats (self-built components)', () => {
    expect(readDisplayedDateValue(fakeInput({ wrapperText: '出生日期 2020.08.15' }))).toBe('2020-08-15')
    expect(readDisplayedDateValue(fakeInput({ wrapperText: '2020年8月' }))).toBe('2020-08')
  })

  it('returns empty when wrapper has no date-like text', () => {
    expect(readDisplayedDateValue(fakeInput({ wrapperText: '请选择日期' }))).toBe('')
  })
})
