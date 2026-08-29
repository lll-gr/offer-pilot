import { describe, expect, it } from 'vitest'

import {
  getModelConfig,
  getActiveModel,
  isConfiguredModel,
  loadModelState,
  MODEL_STORAGE_KEYS,
  normalizeModel,
  normalizeModels,
  saveActiveModelId,
  saveModelState,
  validateBaseUrl,
} from './storage'

type ChromeStorage = typeof chrome.storage

function createFakeStorage(initial: Record<string, unknown> = {}) {
  const state = { ...initial }
  const storage = {
    local: {
      async get(keys: string[]) {
        const out: Record<string, unknown> = {}
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(state, key)) {
            out[key] = state[key]
          }
        }
        return out
      },
      async set(items: Record<string, unknown>) {
        Object.assign(state, items)
      },
      async remove(keys: string[]) {
        for (const key of keys) delete state[key]
      },
    },
  } as unknown as ChromeStorage

  return { storage, state }
}

const customModel = {
  id: 'custom-1',
  name: 'Kimi',
  baseUrl: 'https://api.moonshot.cn/v1',
  apiKey: 'sk-secret',
  model: 'moonshot-v1',
}

describe('model storage', () => {
  it('normalizes model entries and dedupes ids', () => {
    const models = normalizeModels([
      customModel,
      { ...customModel, name: 'duplicate id' },
      null,
    ])

    expect(models.length).toBe(1)
    expect(models[0].name).toBe('Kimi')
    expect(normalizeModel(null)).toBeNull()
  })

  it('validates base URLs', () => {
    expect(validateBaseUrl('https://api.example.com/v1')).toBe(true)
    expect(validateBaseUrl('http://localhost:8787/v1')).toBe(true)
    expect(() => validateBaseUrl('http://api.example.com/v1')).toThrow(/HTTPS/)
    expect(() => validateBaseUrl('not-a-url')).toThrow(/不是有效地址/)
  })

  it('starts with an empty model list and empty active id', async () => {
    const { storage } = createFakeStorage()

    const state = await loadModelState(storage)

    expect(state.models).toEqual([])
    expect(state.activeModelId).toBe('')
    expect(await getActiveModel(storage)).toBeNull()
  })

  it('persists and reloads models with active fallback', async () => {
    const { storage } = createFakeStorage()

    await saveModelState({ models: [customModel] }, storage)
    await saveActiveModelId('custom-1', storage)

    const state = await loadModelState(storage)
    expect(state.models.map((m) => m.id)).toEqual(['custom-1'])
    expect(state.activeModelId).toBe('custom-1')

    const active = await getActiveModel(storage)
    expect(active?.id).toBe('custom-1')
  })

  it('falls back to the first model when active id is stale (deleted)', async () => {
    const { storage } = createFakeStorage({
      [MODEL_STORAGE_KEYS.models]: [customModel, { ...customModel, id: 'custom-2', name: 'DeepSeek' }],
      [MODEL_STORAGE_KEYS.activeModelId]: 'deleted-model',
    })

    const state = await loadModelState(storage)
    expect(state.activeModelId).toBe('custom-1')
  })

  it('getModelConfig resolves the requested model or returns empty config', async () => {
    const { storage } = createFakeStorage({
      [MODEL_STORAGE_KEYS.models]: [customModel],
      [MODEL_STORAGE_KEYS.activeModelId]: 'custom-1',
    })

    const custom = await getModelConfig('custom-1', storage)
    expect(custom.model).toBe('moonshot-v1')

    const missing = await getModelConfig('missing-id', storage)
    expect(missing).toEqual({ baseUrl: '', apiKey: '', model: '' })
  })

  it('isConfiguredModel requires all three fields', () => {
    expect(isConfiguredModel(customModel)).toBe(true)
    expect(isConfiguredModel({ ...customModel, apiKey: '' })).toBe(false)
    expect(isConfiguredModel(null)).toBe(false)
  })
})
