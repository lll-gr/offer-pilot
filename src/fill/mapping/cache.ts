/**
 * 字段映射缓存：以页面 URL + 字段签名为 key（LRU 上限 50 条）。
 * 签名剔除易变信息（占位提示、已填值），同页面字段集不变即命中，
 * 跳过 AI 调用。存储于 chrome.storage.local。
 */

import { MAPPING_CACHE_KEY } from '@/messaging/bridge'
import { normalizeFieldText } from '../scanner/field-text'
import type { FieldDescriptor, FieldMapping } from '../types'

const MAX_CACHE_ENTRIES = 50

export interface CacheFieldSignature {
  index: number
  kind: string
  inputType: string
  required: boolean
  sectionKey: string
  sectionLabel: string
  label: string
  placeholder: string
  name: string
  id: string
  options: string[]
}

export interface MappingCacheEntry {
  updatedAt: number
  mappings: FieldMapping[]
  host: string
  path: string
  signature: CacheFieldSignature[]
}

export interface CacheLookupMeta {
  host: string
  path: string
  signature: CacheFieldSignature[]
}

export interface CacheLookupResult {
  entry: MappingCacheEntry | null
  hit: boolean
  reason: string
}

type StorageArea = {
  get: (keys: string[]) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

function getStorageArea(): StorageArea | null {
  const storage = typeof chrome !== 'undefined' ? (chrome as { storage?: { local?: StorageArea } }).storage : undefined
  return storage?.local ?? null
}

/** 剔除占位/已填值等易变成分，得到稳定签名文本 */
export function normalizeCacheText(value: unknown): string {
  let text = String(value || '').trim()
  if (!text) return ''

  text = text
    .replace(/\s+/g, ' ')
    .replace(/[＊*]+\s*/g, '*')
    .replace(/^(请填写|请选择|请输入|请完整填写)/g, '')
    .replace(/(请填写|请选择|请输入)/g, '')
    .replace(/[*:：]+$/g, '')
    .trim()

  if (!text) return ''

  const starIndex = text.indexOf('*')
  if (starIndex >= 0) {
    text = text.slice(0, starIndex).trim()
  }

  const stablePrefixMatch = text.match(
    /^([\u4e00-\u9fa5A-Za-z]+(?:名称|时间|日期|学历|学位|专业|部门|职位|城市|邮箱|手机|电话|描述|链接|角色|学校|证书|账号|网址))/,
  )
  if (stablePrefixMatch) {
    return stablePrefixMatch[1]
  }

  if (/^(全灵|实习|本科|硕士|博士|男|女|是|否|\d{4}[-/]\d{2}(?:[-/]\d{2})?)$/.test(text)) {
    return ''
  }

  return text
}

function hashString(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index)
  }
  return (hash >>> 0).toString(16)
}

export function createStableCacheFieldSignature(field: FieldDescriptor, index = 0): CacheFieldSignature {
  return {
    index,
    kind: field.kind,
    inputType: field.inputType || '',
    required: Boolean(field.required),
    sectionKey: normalizeCacheText(field.sectionKey || ''),
    sectionLabel: normalizeCacheText(field.sectionLabel || ''),
    label: normalizeCacheText(field.label || ''),
    placeholder: normalizeCacheText(field.placeholder || ''),
    name: normalizeCacheText(field.name || ''),
    id: normalizeCacheText(field.id || ''),
    options: Array.isArray(field.options)
      ? field.options.map((item) => normalizeCacheText(item)).filter(Boolean).slice(0, 8)
      : [],
  }
}

export function createMappingCacheSignature(fields: FieldDescriptor[]): CacheFieldSignature[] {
  return fields.map((field, index) => createStableCacheFieldSignature(field, index))
}

export function createMappingCacheKeyFromSignature(
  signature: CacheFieldSignature[],
  location: { origin: string; pathname: string; host: string }
): string {
  const base = `${location.origin}${location.pathname}::${JSON.stringify(signature)}`
  return `${location.host}:${hashString(base)}`
}

// ---------------------------------------------------------------------------
// 差异诊断（日志可读）
// ---------------------------------------------------------------------------

function describeCacheFieldDifference(previous: CacheFieldSignature | undefined, current: CacheFieldSignature | undefined, index: number): string {
  const changes: string[] = []

  if ((previous?.kind || '') !== (current?.kind || '')) {
    changes.push(`kind ${previous?.kind || '(empty)'} -> ${current?.kind || '(empty)'}`)
  }
  if ((previous?.inputType || '') !== (current?.inputType || '')) {
    changes.push(`inputType ${previous?.inputType || '(empty)'} -> ${current?.inputType || '(empty)'}`)
  }
  if ((previous?.sectionLabel || '') !== (current?.sectionLabel || '')) {
    changes.push(`section ${previous?.sectionLabel || '(empty)'} -> ${current?.sectionLabel || '(empty)'}`)
  }
  if ((previous?.label || '') !== (current?.label || '')) {
    changes.push(`label ${previous?.label || '(empty)'} -> ${current?.label || '(empty)'}`)
  }
  if ((previous?.placeholder || '') !== (current?.placeholder || '')) {
    changes.push(`placeholder ${previous?.placeholder || '(empty)'} -> ${current?.placeholder || '(empty)'}`)
  }
  if ((previous?.name || '') !== (current?.name || '')) {
    changes.push(`name ${previous?.name || '(empty)'} -> ${current?.name || '(empty)'}`)
  }
  if ((previous?.id || '') !== (current?.id || '')) {
    changes.push(`id ${previous?.id || '(empty)'} -> ${current?.id || '(empty)'}`)
  }

  const previousOptions = JSON.stringify(previous?.options || [])
  const currentOptions = JSON.stringify(current?.options || [])
  if (previousOptions !== currentOptions) {
    changes.push(`options ${previousOptions} -> ${currentOptions}`)
  }

  return `#${index + 1} ${changes[0] || '结构变化'}`
}

export function summarizeCacheSignatureDifference(
  currentSignature: CacheFieldSignature[],
  previousSignature: CacheFieldSignature[] | undefined
): string {
  if (!Array.isArray(currentSignature) || currentSignature.length === 0) {
    return '当前扫描签名为空'
  }

  if (!Array.isArray(previousSignature) || previousSignature.length === 0) {
    return '历史缓存缺少签名明细'
  }

  if (currentSignature.length !== previousSignature.length) {
    return `字段数量 ${previousSignature.length} -> ${currentSignature.length}`
  }

  const diffs: string[] = []
  for (let index = 0; index < currentSignature.length; index += 1) {
    const current = currentSignature[index]
    const previous = previousSignature[index]
    if (JSON.stringify(current) === JSON.stringify(previous)) {
      continue
    }
    diffs.push(describeCacheFieldDifference(previous, current, index))
  }

  if (diffs.length === 0) {
    return '签名一致，但缓存条目不存在'
  }

  return `差异字段 ${diffs.length} 个，示例：${diffs.slice(0, 3).join('；')}`
}

/** 纯函数形式的缓存查询描述（不触 storage），便于测试与日志 */
export function describeMappingCacheLookup(
  cache: Record<string, MappingCacheEntry> | null | undefined,
  cacheKey: string,
  meta: CacheLookupMeta
): CacheLookupResult {
  const normalizedCache = cache && typeof cache === 'object' ? cache : {}
  const keys = Object.keys(normalizedCache)
  const entry = normalizedCache[cacheKey] || null
  const shortKey = String(cacheKey || '').split(':').pop() || '(empty)'

  if (entry) {
    return {
      entry,
      hit: true,
      reason: `命中 key=${shortKey} total=${keys.length}`,
    }
  }

  if (keys.length === 0) {
    return {
      entry: null,
      hit: false,
      reason: `缓存为空 key=${shortKey}`,
    }
  }

  const samePageEntries = Object.entries(normalizedCache)
    .filter(([, item]) => item?.host === meta.host && item?.path === meta.path)
    .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))

  if (samePageEntries.length === 0) {
    return {
      entry: null,
      hit: false,
      reason: `缓存中没有当前页面记录 key=${shortKey} total=${keys.length}`,
    }
  }

  const latestSamePage = samePageEntries[0]?.[1] || null
  const difference = summarizeCacheSignatureDifference(meta.signature, latestSamePage?.signature)

  return {
    entry: null,
    hit: false,
    reason: `同页面已有${samePageEntries.length}条缓存，但当前字段签名已变化 key=${shortKey} ${difference}`,
  }
}

// ---------------------------------------------------------------------------
// storage 读写（带 LRU 淘汰）
// ---------------------------------------------------------------------------

export async function loadMappingCacheEntry(
  cacheKey: string,
  meta: CacheLookupMeta,
  storageOverride?: StorageArea
): Promise<CacheLookupResult> {
  const storage = storageOverride ?? getStorageArea()
  if (!storage) {
    return { entry: null, hit: false, reason: 'storage 不可用' }
  }

  const data = await storage.get([MAPPING_CACHE_KEY])
  const cache = data[MAPPING_CACHE_KEY] as Record<string, MappingCacheEntry> | undefined
  return describeMappingCacheLookup(cache, cacheKey, meta)
}

export async function saveMappingCacheEntry(
  cacheKey: string,
  entry: MappingCacheEntry,
  storageOverride?: StorageArea
): Promise<void> {
  const storage = storageOverride ?? getStorageArea()
  if (!storage) return

  const data = await storage.get([MAPPING_CACHE_KEY])
  const cache =
    data[MAPPING_CACHE_KEY] && typeof data[MAPPING_CACHE_KEY] === 'object'
      ? (data[MAPPING_CACHE_KEY] as Record<string, MappingCacheEntry>)
      : {}

  cache[cacheKey] = entry

  const keys = Object.keys(cache).sort((left, right) => {
    const leftTime = Number(cache[left]?.updatedAt || 0)
    const rightTime = Number(cache[right]?.updatedAt || 0)
    return rightTime - leftTime
  })

  const nextCache: Record<string, MappingCacheEntry> = {}
  keys.slice(0, MAX_CACHE_ENTRIES).forEach((key) => {
    nextCache[key] = cache[key]
  })

  await storage.set({ [MAPPING_CACHE_KEY]: nextCache })
}

export async function clearMappingCache(storageOverride?: StorageArea): Promise<void> {
  const storage = storageOverride ?? getStorageArea()
  if (!storage?.set) return
  await storage.set({ [MAPPING_CACHE_KEY]: {} })
}

export { normalizeFieldText }
