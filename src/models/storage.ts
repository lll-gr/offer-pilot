/**
 * AI 模型配置的本地持久化：内置 DeepSeek + 任意自定义模型，
 * 支持激活切换。storageOverride 用于测试注入。
 */

export interface ModelConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  builtin: boolean
}

export const MODEL_STORAGE_KEYS = {
  models: 'aiModels',
  builtinOverride: 'builtinModelOverride',
  activeModelId: 'activeModelId',
} as const

export const DEFAULT_MODEL: Readonly<ModelConfig> = Object.freeze({
  id: 'builtin-deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  builtin: true,
})

interface AreaLike {
  get: (keys: string[]) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

interface StorageLike {
  local: AreaLike
}

type ChromeStorage = typeof chrome.storage

export interface ModelState {
  models: ModelConfig[]
  builtinOverride: Partial<ModelConfig> | null
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

export function normalizeModel(model: unknown, fallbackId = ''): ModelConfig | null {
  if (!model || typeof model !== 'object') return null

  const record = model as Record<string, unknown>
  const id = text(record.id) || fallbackId
  if (!id) return null

  return {
    id,
    name: text(record.name) || '自定义模型',
    baseUrl: text(record.baseUrl),
    apiKey: text(record.apiKey),
    model: text(record.model),
    builtin: Boolean(record.builtin),
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
      return model.id !== DEFAULT_MODEL.id
    })
}

export function buildBuiltinModel(override: Partial<ModelConfig> | null): ModelConfig {
  const normalized = normalizeModel({
    ...DEFAULT_MODEL,
    ...(override && typeof override === 'object' ? override : {}),
    id: DEFAULT_MODEL.id,
    builtin: true,
  })

  return normalized || { ...DEFAULT_MODEL }
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
  const builtinOverride =
    localData[MODEL_STORAGE_KEYS.builtinOverride] &&
    typeof localData[MODEL_STORAGE_KEYS.builtinOverride] === 'object'
      ? (localData[MODEL_STORAGE_KEYS.builtinOverride] as Partial<ModelConfig>)
      : null
  let activeModelId = text(localData[MODEL_STORAGE_KEYS.activeModelId])

  if (!activeModelId) {
    activeModelId = DEFAULT_MODEL.id
    await storage.local.set({ [MODEL_STORAGE_KEYS.activeModelId]: activeModelId })
  }

  return { models, builtinOverride, activeModelId }
}

export async function saveModelState(
  { models, builtinOverride = null }: { models: ModelConfig[]; builtinOverride?: Partial<ModelConfig> | null },
  storageOverride?: ChromeStorage
): Promise<void> {
  const storage = getStorage(storageOverride)
  await storage.local.set({
    [MODEL_STORAGE_KEYS.models]: normalizeModels(models),
    [MODEL_STORAGE_KEYS.builtinOverride]:
      builtinOverride && typeof builtinOverride === 'object' ? builtinOverride : null,
  })
}

export async function saveActiveModelId(modelId: string, storageOverride?: ChromeStorage): Promise<void> {
  const storage = getStorage(storageOverride)
  await storage.local.set({
    [MODEL_STORAGE_KEYS.activeModelId]: text(modelId) || DEFAULT_MODEL.id,
  })
}

export async function getModelConfig(modelId: string, storageOverride?: ChromeStorage): Promise<{
  baseUrl: string
  apiKey: string
  model: string
}> {
  const state = await loadModelState(storageOverride)
  const builtin = buildBuiltinModel(state.builtinOverride)
  const selected = [builtin, ...state.models].find((item) => item.id === text(modelId)) || builtin

  return {
    baseUrl: selected.baseUrl,
    apiKey: selected.apiKey,
    model: selected.model,
  }
}

export async function getActiveModel(storageOverride?: ChromeStorage): Promise<ModelConfig> {
  const state = await loadModelState(storageOverride)
  const builtin = buildBuiltinModel(state.builtinOverride)
  return [builtin, ...state.models].find((item) => item.id === state.activeModelId) || builtin
}

export function isConfiguredModel(model: ModelConfig | null | undefined): boolean {
  return Boolean(model?.baseUrl && model?.apiKey && model?.model)
}
