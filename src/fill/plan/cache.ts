/**
 * 填充计划缓存：以页面 URL + 字段签名为 key（LRU 上限 50 条）。
 * 存 FieldDecision（映射 + 五动作决策快照），重放= 对齐后的决策直接执行。
 * 旧版条目（mappings 无 action）读取时适配为 decisions，action 一律回退 fill。
 * 签名剔除易变信息（占位提示、已填值），同页面字段集不变即命中，跳过 AI 调用。
 */

import { MAPPING_CACHE_KEY } from '@/messaging/bridge'
import { normalizeFieldText } from '../scanner/field-text'
import type { FieldAction, FieldConfidence, FieldDecision, FieldDescriptor, Transform } from '../types'
import { FIELD_ACTIONS, FIELD_CONFIDENCES } from './payload'

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
  decisions: FieldDecision[]
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

/**
 * 位置无关的哈希原料：排序消除字段顺序/插入位移影响。
 * 重复字段（如起止时间对）靠 label 重复出现本身区分，不依赖 index。
 */
function serializeSignatureStable(signature: CacheFieldSignature[]): string {
  const parts = signature
    .map((field) =>
      [
        field.kind,
        field.inputType,
        field.required ? '1' : '0',
        field.sectionKey,
        field.sectionLabel,
        field.label,
        field.placeholder,
        field.name,
        field.id,
        field.options.join('|'),
      ].join('\u0001'),
    )
    .sort()
  return parts.join('\u0002')
}

export function createMappingCacheKeyFromSignature(
  signature: CacheFieldSignature[],
  location: { origin: string; pathname: string; host: string }
): string {
  const base = `${location.origin}${location.pathname}::${serializeSignatureStable(signature)}`
  return `${location.host}:${hashString(base)}`
}

/**
 * 单字段指纹：缓存决策条目的对齐键。
 * 由扫描稳定属性组成，与扫描序号（fieldId）无关——同一表单重复扫描时指纹不变，
 * 字段增删/位移导致序号漂移时仍能对上。
 */
export function createFieldKey(field: {
  kind: string
  label?: string
  name?: string
  id?: string
  inputType?: string
  options?: string[]
}): string {
  return [
    field.kind,
    field.inputType || '',
    normalizeCacheText(field.label || ''),
    normalizeCacheText(field.name || ''),
    normalizeCacheText(field.id || ''),
    (field.options || []).map((item) => normalizeCacheText(item)).filter(Boolean).slice(0, 8).join('|'),
  ].join('\u0001')
}

function toValidAction(value: unknown): FieldAction {
  const text = String(value || '').trim()
  return (FIELD_ACTIONS as string[]).includes(text) ? (text as FieldAction) : 'fill'
}

function toValidConfidence(value: unknown): FieldConfidence {
  const text = String(value || '').trim()
  return (FIELD_CONFIDENCES as string[]).includes(text) ? (text as FieldConfidence) : 'medium'
}

/**
 * 缓存重放对齐：把带 fieldKey 的缓存决策条目安到当前扫描字段上。
 * 按指纹匹配（序号无关）；无指纹的条目直接丢弃（不背旧格式兼容）。
 * 未匹配到的决策直接丢弃（宁可不填不错填）。
 */
export function alignCachedDecisions(
  cachedDecisions: Array<{
    fieldId?: string
    action?: string
    confidence?: string
    fieldKey?: string
    resumePath?: string
    reason?: string
    transform?: unknown
  }>,
  currentFields: Array<{
    fieldId: string
    kind: string
    label?: string
    name?: string
    id?: string
    inputType?: string
    options?: string[]
  }>
): FieldDecision[] {
  // 指纹 → 候选字段 id 队列（同指纹多字段如起止时间对，按出现顺序消费）
  const candidatesByKey = new Map<string, string[]>()
  for (const field of currentFields) {
    const key = createFieldKey(field)
    const queue = candidatesByKey.get(key) || []
    queue.push(field.fieldId)
    candidatesByKey.set(key, queue)
  }

  const out: FieldDecision[] = []
  const consumedFieldIds = new Set<string>()

  const takeCandidate = (key: string): string | undefined => {
    const queue = candidatesByKey.get(key)
    if (!queue) return undefined
    while (queue.length > 0) {
      const candidate = queue.shift()
      if (candidate && !consumedFieldIds.has(candidate)) return candidate
    }
    return undefined
  }

  for (const decision of cachedDecisions) {
    if (!decision.fieldKey) continue
    const targetFieldId = takeCandidate(decision.fieldKey)

    if (!targetFieldId) continue

    consumedFieldIds.add(targetFieldId)
    out.push({
      fieldId: targetFieldId,
      action: toValidAction(decision.action),
      resumePath: String(decision.resumePath || ''),
      reason: String(decision.reason || ''),
      transform: (decision.transform ?? { type: 'none' }) as Transform,
      confidence: toValidConfidence(decision.confidence),
      fieldKey: decision.fieldKey,
    })
  }

  return out
}

/**
 * 纠错写回：把用户修正的决策按指纹更新进缓存条目（纯函数，可测）。
 * 修正同时落 resumePath 与 action，下次重放连同动作一起生效。
 */
export function applyDecisionCorrection(
  entry: MappingCacheEntry,
  correction: { fieldKey: string; fieldId: string; resumePath: string; action?: FieldAction }
): MappingCacheEntry {
  const corrected = entry.decisions.map((item) =>
    item.fieldKey === correction.fieldKey
      ? {
          ...item,
          resumePath: correction.resumePath,
          action: correction.action ?? item.action,
          reason: '用户手动修正',
        }
      : item,
  )
  return { ...entry, decisions: corrected, updatedAt: Date.now() }
}

/** 旧版条目（mappings 无 action）读取时适配为 decisions，action 一律回退 fill */
export function adaptLegacyCacheEntry(raw: unknown): MappingCacheEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as {
    updatedAt?: unknown
    decisions?: unknown
    mappings?: unknown
    host?: unknown
    path?: unknown
    signature?: unknown
  }

  if (Array.isArray(record.decisions)) {
    const decisions = record.decisions.map((item) => {
      const decision = item as Partial<FieldDecision>
      return {
        fieldId: String(decision.fieldId || ''),
        action: toValidAction(decision.action),
        resumePath: String(decision.resumePath || ''),
        reason: String(decision.reason || ''),
        transform: (decision.transform ?? { type: 'none' }) as Transform,
        confidence: toValidConfidence(decision.confidence),
        fieldKey: decision.fieldKey ? String(decision.fieldKey) : undefined,
      }
    })
    return { ...record, decisions } as MappingCacheEntry
  }

  const legacyMappings = Array.isArray(record.mappings) ? record.mappings : []
  const decisions: FieldDecision[] = legacyMappings.map((item) => {
    const mapping = item as {
      fieldId?: unknown
      resumePath?: unknown
      reason?: unknown
      transform?: unknown
      fieldKey?: unknown
    }
    return {
      fieldId: String(mapping.fieldId || ''),
      action: 'fill' as const,
      resumePath: String(mapping.resumePath || ''),
      reason: String(mapping.reason || ''),
      transform: (mapping.transform ?? { type: 'none' }) as Transform,
      confidence: 'medium' as const,
      fieldKey: mapping.fieldKey ? String(mapping.fieldKey) : undefined,
    }
  })

  const { mappings: _mappings, ...rest } = record
  return { ...rest, decisions } as MappingCacheEntry
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
  cache: Record<string, unknown> | null | undefined,
  cacheKey: string,
  meta: CacheLookupMeta
): CacheLookupResult {
  const normalizedCache = cache && typeof cache === 'object' ? cache : {}
  const keys = Object.keys(normalizedCache)
  const rawEntry = normalizedCache[cacheKey] || null
  const entry = adaptLegacyCacheEntry(rawEntry)
  const shortKey = String(cacheKey || '').split(':').pop() || '(empty)'

  if (rawEntry) {
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
    .filter(([, item]) => {
      const legacy = item as { host?: unknown; path?: unknown }
      return legacy?.host === meta.host && legacy?.path === meta.path
    })
    .sort((left, right) => Number((right[1] as { updatedAt?: unknown })?.updatedAt || 0) - Number((left[1] as { updatedAt?: unknown })?.updatedAt || 0))

  if (samePageEntries.length === 0) {
    return {
      entry: null,
      hit: false,
      reason: `缓存中没有当前页面记录 key=${shortKey} total=${keys.length}`,
    }
  }

  const latestSamePage = adaptLegacyCacheEntry(samePageEntries[0]?.[1])
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
