import { describe, expect, it } from 'vitest'

import {
  buildBuiltinModel,
  DEFAULT_MODEL,
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
  builtin: false,
}

describe('model storage', () => {
  it('normalizes model entries and dedupes ids', () => {
    const models = normalizeModels([
      customModel,
      { ...customModel, name: 'duplicate id' },
      { id: 'builtin-deepseek', name: '内置模型占位' },
      null,
    ])

    expect(models.length).toBe(1)
    expect(models[0].name).toBe('Kimi')
    expect(normalizeModel(null)).toBeNull()
  })

  it('builds builtin model with override applied but id/builtin pinned', () => {
    const builtin = buildBuiltinModel({ name: 'DeepSeek 改', apiKey: 'sk-1' })

    expect(builtin.id).toBe(DEFAULT_MODEL.id)
    expect(builtin.builtin).toBe(true)
    expect(builtin.name).toBe('DeepSeek 改')
    expect(builtin.baseUrl).toBe(DEFAULT_MODEL.baseUrl)
  })

  it('validates base URLs', () => {
    expect(validateBaseUrl('https://api.example.com/v1')).toBe(true)
    expect(validateBaseUrl('http://localhost:8787/v1')).toBe(true)
    expect(() => validateBaseUrl('http://api.example.com/v1')).toThrow(/HTTPS/)
    expect(() => validateBaseUrl('not-a-url')).toThrow(/不是有效地址/)
  })

  it('persists and reloads model state with active fallback', async () => {
    const { storage } = createFakeStorage()

    await saveModelState({ models: [customModel], builtinOverride: { apiKey: 'sk-2' } }, storage)
    const state = await loadModelState(storage)

    expect(state.models.map((m) => m.id)).toEqual(['custom-1'])
    expect(state.builtinOverride?.apiKey).toBe('sk-2')
    expect(state.activeModelId).toBe(DEFAULT_MODEL.id)

    await saveActiveModelId('custom-1', storage)
    const active = await getActiveModel(storage)
    expect(active.id).toBe('custom-1')
  })

  it('getModelConfig resolves the requested model or falls back to builtin', async () => {
    const { storage } = createFakeStorage({
      [MODEL_STORAGE_KEYS.models]: [customModel],
      [MODEL_STORAGE_KEYS.activeModelId]: 'custom-1',
    })

    const custom = await getModelConfig('custom-1', storage)
    expect(custom.model).toBe('moonshot-v1')

    const fallback = await getModelConfig('missing-id', storage)
    expect(fallback.model).toBe(DEFAULT_MODEL.model)
  })

  it('isConfiguredModel requires all three fields', () => {
    expect(isConfiguredModel(customModel)).toBe(true)
    expect(isConfiguredModel({ ...customModel, apiKey: '' })).toBe(false)
    expect(isConfiguredModel(null)).toBe(false)
  })
})
