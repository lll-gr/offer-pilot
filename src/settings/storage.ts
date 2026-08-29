/**
 * 应用设置（chrome.storage.local）：填充行为调参 + 性能阈值。
 * 红线类行为（永不自动提交、敏感字段强制人工）不进配置——它们是产品底线，
 * 这里只放「性能与体验」类参数，读写都经归一化钳制到安全区间。
 */

export interface FillSettings {
  /** 分步填充最大轮数（防异常页面死循环） */
  segmentMaxRounds: number
  /** AI 规划单批字段数上限 */
  aiBatchSize: number
  /** 字段填充失败自动重试次数 */
  fillRetryCount: number
  /** 深度扫描展开轮数 */
  deepScanMaxRounds: number
  /** 已填字段高亮清除延时（ms，0=不自动清除） */
  highlightAutoClearMs: number
  /** AI 请求超时（ms） */
  requestTimeoutMs: number
  /** 决策缓存条目上限 */
  cacheMaxEntries: number
}

export const SETTINGS_KEY = 'appSettings'

export const DEFAULT_SETTINGS: Readonly<FillSettings> = Object.freeze({
  segmentMaxRounds: 30,
  aiBatchSize: 30,
  fillRetryCount: 1,
  deepScanMaxRounds: 5,
  highlightAutoClearMs: 6000,
  requestTimeoutMs: 120_000,
  cacheMaxEntries: 50,
})

/** 每项的合法区间（含端点） */
const RANGES: Record<keyof FillSettings, [number, number]> = {
  segmentMaxRounds: [1, 100],
  aiBatchSize: [5, 100],
  fillRetryCount: [0, 3],
  deepScanMaxRounds: [0, 20],
  highlightAutoClearMs: [0, 60_000],
  requestTimeoutMs: [10_000, 600_000],
  cacheMaxEntries: [5, 500],
}

function clampInt(value: unknown, [min, max]: [number, number], fallback: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  const int = Math.round(num)
  return Math.min(max, Math.max(min, int))
}

/** 任意输入 → 合法 settings（未知字段丢弃，越界钳制） */
export function normalizeSettings(input: unknown): FillSettings {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const result = { ...DEFAULT_SETTINGS }

  for (const key of Object.keys(RANGES) as Array<keyof FillSettings>) {
    if (record[key] == null) continue
    result[key] = clampInt(record[key], RANGES[key], DEFAULT_SETTINGS[key])
  }
  return result
}

interface AreaLike {
  get: (keys: string[]) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

function getStorage(): AreaLike | null {
  const globalChrome = typeof chrome !== 'undefined' ? (chrome as { storage?: { local?: AreaLike } }) : undefined
  return globalChrome?.storage?.local ?? null
}

export async function loadSettings(): Promise<FillSettings> {
  const storage = getStorage()
  if (!storage) return { ...DEFAULT_SETTINGS }

  try {
    const data = await storage.get([SETTINGS_KEY])
    return normalizeSettings(data[SETTINGS_KEY])
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(settings: FillSettings): Promise<FillSettings> {
  const storage = getStorage()
  const normalized = normalizeSettings(settings)
  if (storage) {
    try {
      await storage.set({ [SETTINGS_KEY]: normalized })
    } catch {
      // 存储失败静默：本次会话仍用返回值
    }
  }
  return normalized
}

/** content script 侧的同步兜底：异步加载失败/未就绪时用默认值（填充不因设置读不到而中断） */
export async function loadSettingsSafe(): Promise<FillSettings> {
  return loadSettings()
}
