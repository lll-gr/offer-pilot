import { describe, expect, it } from 'vitest'

import {
  CONTENT_SCRIPT_VERSION,
  contentScriptHasDiagnosticsSupport,
  MAPPING_CACHE_KEY,
} from './bridge'

describe('content bridge', () => {
  it('accepts matching version and capability', () => {
    expect(
      contentScriptHasDiagnosticsSupport({
        success: true,
        version: CONTENT_SCRIPT_VERSION,
        capabilities: { fullDiagnostics: true },
      }),
    ).toBe(true)
  })

  it('rejects stale or partial responses', () => {
    expect(contentScriptHasDiagnosticsSupport({ success: true })).toBe(false)
    expect(
      contentScriptHasDiagnosticsSupport({
        success: true,
        version: 'old-version',
        capabilities: { fullDiagnostics: true },
      }),
    ).toBe(false)
    expect(
      contentScriptHasDiagnosticsSupport({
        success: true,
        version: CONTENT_SCRIPT_VERSION,
        capabilities: { fullDiagnostics: false },
      }),
    ).toBe(false)
    expect(contentScriptHasDiagnosticsSupport(null)).toBe(false)
  })

  it('exposes the shared mapping cache key', () => {
    expect(MAPPING_CACHE_KEY).toBe('fieldMappingCacheV3')
  })
})
