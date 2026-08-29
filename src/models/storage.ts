/**
 * AI 模型配置的本地持久化：模型列表由用户自建（无内置项），
 * 支持激活切换。storageOverride 用于测试注入。
 */

export interface ModelConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

export const MODEL_STORAGE_KEYS = {
  models: 'aiModels',
  activeModelId: 'activeModelId',
} as const

interface AreaLike {
  get: (keys: string[]) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
  remove?: (keys: string[]) => Promise<void>
}

interface StorageLike {
  local: AreaLike
}

type ChromeStorage = typeof chrome.storage

export interface ModelState {
  models: ModelConfig[]
  activeModelId: string
}

function getStorage(storageOverride?: ChromeStorage): StorageLike {
  const globalChrome = typeof chrome !== 'undefined' ? (chrome as { storage?: unknown }) : undefined
  const storage = storageOverride || (globalChrome?.storage as ChromeStorage | undefined)
  if (!storage?.local?.get || !storage?.local?.set) {
    throw new Error('扩展本地存储不可用')
  }
  return storage as unknown as StorageLike
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

export function normalizeModel(model: unknown): ModelConfig | null {
  if (!model || typeof model !== 'object') return null

  const record = model as Record<string, unknown>
  const id = text(record.id)
  if (!id) return null

  return {
    id,
    name: text(record.name) || '自定义模型',
    baseUrl: text(record.baseUrl),
    apiKey: text(record.apiKey),
    model: text(record.model),
  }
}

export function normalizeModels(value: unknown): ModelConfig[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  return value
    .map((model) => normalizeModel(model))
    .filter((model): model is ModelConfig => {
      if (!model || seen.has(model.id)) return false
      seen.add(model.id)
      return true
    })
}

export function validateBaseUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(text(value))
  } catch {
    throw new Error('Base URL 不是有效地址')
  }

  const isLocalDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalDevelopmentHost)) {
    throw new Error('Base URL 必须使用 HTTPS（本机开发地址可使用 HTTP）')
  }
  return true
}

export async function loadModelState(storageOverride?: ChromeStorage): Promise<ModelState> {
  const storage = getStorage(storageOverride)
  const localData = await storage.local.get(Object.values(MODEL_STORAGE_KEYS))

  const models = normalizeModels(localData[MODEL_STORAGE_KEYS.models])
  const activeModelId = text(localData[MODEL_STORAGE_KEYS.activeModelId])

  // 激活 id 失效（模型被删）时回退到第一个；无模型时为空串
  const effectiveActiveId =
    models.length === 0 ? '' : models.some((model) => model.id === activeModelId) ? activeModelId : models[0].id

  if (effectiveActiveId !== activeModelId) {
    await storage.local.set({ [MODEL_STORAGE_KEYS.activeModelId]: effectiveActiveId })
  }

  return { models, activeModelId: effectiveActiveId }
}

export async function saveModelState(
  { models }: { models: ModelConfig[] },
  storageOverride?: ChromeStorage
): Promise<void> {
  const storage = getStorage(storageOverride)
  await storage.local.set({
    [MODEL_STORAGE_KEYS.models]: normalizeModels(models),
  })
}

export async function saveActiveModelId(modelId: string, storageOverride?: ChromeStorage): Promise<void> {
  const storage = getStorage(storageOverride)
  await storage.local.set({
    [MODEL_STORAGE_KEYS.activeModelId]: text(modelId),
  })
}

export async function getModelConfig(modelId: string, storageOverride?: ChromeStorage): Promise<{
  baseUrl: string
  apiKey: string
  model: string
}> {
  const state = await loadModelState(storageOverride)
  const selected = state.models.find((item) => item.id === text(modelId))

  return {
    baseUrl: selected?.baseUrl || '',
    apiKey: selected?.apiKey || '',
    model: selected?.model || '',
  }
}

export async function getActiveModel(storageOverride?: ChromeStorage): Promise<ModelConfig | null> {
  const state = await loadModelState(storageOverride)
  return state.models.find((item) => item.id === state.activeModelId) || null
}

export function isConfiguredModel(model: ModelConfig | null | undefined): boolean {
  return Boolean(model?.baseUrl && model?.apiKey && model?.model)
}
