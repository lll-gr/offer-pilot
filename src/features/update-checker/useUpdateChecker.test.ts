import { describe, expect, it } from 'vitest'

import { isNewerVersion } from './useUpdateChecker'

describe('isNewerVersion', () => {
  it('compares semver segments correctly', () => {
    expect(isNewerVersion('0.0.4', '0.0.3')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.0.9')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('0.0.3', '0.0.3')).toBe(false)
    expect(isNewerVersion('0.0.2', '0.0.3')).toBe(false)
  })

  it('strips v prefix', () => {
    expect(isNewerVersion('v0.0.4', '0.0.3')).toBe(true)
    expect(isNewerVersion('v1.2.3', 'v1.2.3')).toBe(false)
  })

  it('tolerates malformed versions without throwing', () => {
    expect(isNewerVersion('', '0.0.3')).toBe(false)
    expect(isNewerVersion('0.0.4', '')).toBe(true)
    expect(isNewerVersion('abc', '0.0.3')).toBe(false)
    expect(isNewerVersion('0.0.4', 'abc')).toBe(true)
  })
})
