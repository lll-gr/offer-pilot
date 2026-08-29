import { beforeEach, describe, expect, it } from 'vitest'

import { parseImportedConfig } from './transfer'

const VALID_CONFIG = {
  format: 'offer-pilot-config',
  version: 1,
  exportedAt: '2026-08-29T00:00:00Z',
  data: {
    models: [{ id: 'm1', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', model: 'deepseek-chat' }],
    activeModelId: 'm1',
    resumeSlots: [
      { id: 's1', name: '默认', company: '', position: '', profile: { personal: { fullName: '张三' } }, rawText: '', createdAt: 1, updatedAt: 1 },
    ],
    resumeActiveSlotId: 's1',
    settings: { segmentMaxRounds: 50, aiBatchSize: 30 },
  },
}

describe('parseImportedConfig', () => {
  it('parses a valid export', () => {
    const config = parseImportedConfig(JSON.stringify(VALID_CONFIG))
    expect(config.data.models).toHaveLength(1)
    expect(config.data.resumeSlots).toHaveLength(1)
    expect(config.data.settings.segmentMaxRounds).toBe(50)
  })

  it('rejects non-JSON and foreign JSON', () => {
    expect(() => parseImportedConfig('not json')).toThrow(/JSON/)
    expect(() => parseImportedConfig('{"foo":1}')).toThrow(/配置文件/)
    expect(() => parseImportedConfig('{"format":"other-app"}')).toThrow(/配置文件/)
  })

  it('tolerates missing data fields with defaults', () => {
    const config = parseImportedConfig(JSON.stringify({ format: 'offer-pilot-config', version: 1, data: {} }))
    expect(config.data.models).toEqual([])
    expect(config.data.resumeSlots).toEqual([])
    expect(config.data.settings).toEqual({})
    expect(config.data.activeModelId).toBe('')
  })
})
