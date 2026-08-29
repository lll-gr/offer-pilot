import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, normalizeSettings, SETTINGS_KEY } from './storage'
import type { FillSettings } from './storage'

describe('normalizeSettings', () => {
  it('returns defaults for empty or malformed input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values and clamps out-of-range ones', () => {
    const result = normalizeSettings({
      segmentMaxRounds: 50, // 合法
      aiBatchSize: 3, // 低于下限 5 → 钳到 5
      fillRetryCount: 99, // 超上限 3 → 钳到 3
      deepScanMaxRounds: -1, // 低于 0 → 钳到 0
      highlightAutoClearMs: 0, // 合法下限（不自动清除）
      requestTimeoutMs: 30_000,
      cacheMaxEntries: 10_000, // 钳到 500
    })

    expect(result.segmentMaxRounds).toBe(50)
    expect(result.aiBatchSize).toBe(5)
    expect(result.fillRetryCount).toBe(3)
    expect(result.deepScanMaxRounds).toBe(0)
    expect(result.highlightAutoClearMs).toBe(0)
    expect(result.requestTimeoutMs).toBe(30_000)
    expect(result.cacheMaxEntries).toBe(500)
  })

  it('rounds floats and ignores non-numeric junk', () => {
    const result = normalizeSettings({
      segmentMaxRounds: 12.6, // → 13
      fillRetryCount: 'abc', // → 默认
      cacheMaxEntries: '42', // 数字字符串可解析
    })

    expect(result.segmentMaxRounds).toBe(13)
    expect(result.fillRetryCount).toBe(DEFAULT_SETTINGS.fillRetryCount)
    expect(result.cacheMaxEntries).toBe(42)
  })

  it('drops unknown keys', () => {
    const result = normalizeSettings({ autoSubmit: true, evil: 'x' })
    expect(result).toEqual(DEFAULT_SETTINGS)
    expect('autoSubmit' in result).toBe(false)
  })
})
