/**
 * 多简历档位存储（简历数据唯一真源）：每档含 profile/rawText + 投递上下文（company/position）。
 * storageOverride 用于测试注入。
 */

import type { ResumeProfile } from './schema'
import { createEmptyResumeProfile, normalizeResumeProfile } from './schema'

export const RESUME_SLOT_KEYS = {
  slots: 'resumeSlots',
  activeSlotId: 'resumeActiveSlotId',
} as const

export interface ResumeSlot {
  id: string
  name: string
  company: string
  position: string
  profile: ResumeProfile
  rawText: string
  createdAt: number
  updatedAt: number
}

export interface ResumeSlotState {
  slots: ResumeSlot[]
  activeSlotId: string
}

interface AreaLike {
  get: (keys: string[]) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

interface StorageLike {
  local: AreaLike
}

type ChromeStorage = typeof chrome.storage

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

export function createSlot(name = '默认档', overrides: Partial<Omit<ResumeSlot, 'id'>> = {}): ResumeSlot {
  const now = Date.now()
  return {
    id: `slot-${now}-${Math.floor(Math.random() * 10000)}`,
    name: text(name) || '未命名档位',
    company: '',
    position: '',
    profile: createEmptyResumeProfile(),
    rawText: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function normalizeSlot(value: unknown): ResumeSlot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = text(record.id)
  if (!id) return null

  const now = Date.now()
  return {
    id,
    name: text(record.name) || '未命名档位',
    company: text(record.company),
    position: text(record.position),
    profile: normalizeResumeProfile(record.profile),
    rawText: text(record.rawText),
    createdAt: Number(record.createdAt) || now,
    updatedAt: Number(record.updatedAt) || now,
  }
}

function normalizeSlots(value: unknown): ResumeSlot[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: ResumeSlot[] = []
  for (const item of value) {
    const slot = normalizeSlot(item)
    if (!slot || seen.has(slot.id)) continue
    seen.add(slot.id)
    out.push(slot)
  }
  return out.length > 0 ? out : []
}

export async function loadSlotState(storageOverride?: ChromeStorage): Promise<ResumeSlotState> {
  const storage = getStorage(storageOverride)
  const data = await storage.local.get(Object.values(RESUME_SLOT_KEYS))

  let slots = normalizeSlots(data[RESUME_SLOT_KEYS.slots])
  let activeSlotId = text(data[RESUME_SLOT_KEYS.activeSlotId])

  if (slots.length === 0) {
    // 首启惰性创建默认档并激活
    const fallback = createSlot()
    slots = [fallback]
    activeSlotId = fallback.id
    await storage.local.set({
      [RESUME_SLOT_KEYS.slots]: slots,
      [RESUME_SLOT_KEYS.activeSlotId]: activeSlotId,
    })
  }

  if (!slots.some((slot) => slot.id === activeSlotId)) {
    activeSlotId = slots[0].id
  }

  return { slots, activeSlotId }
}

export async function saveSlotState(
  { slots, activeSlotId }: ResumeSlotState,
  storageOverride?: ChromeStorage
): Promise<void> {
  const storage = getStorage(storageOverride)
  await storage.local.set({
    [RESUME_SLOT_KEYS.slots]: slots,
    [RESUME_SLOT_KEYS.activeSlotId]: activeSlotId,
  })
}

export async function getActiveSlot(storageOverride?: ChromeStorage): Promise<ResumeSlot | null> {
  const { slots, activeSlotId } = await loadSlotState(storageOverride)
  return slots.find((slot) => slot.id === activeSlotId) ?? null
}

/** 保存激活档的 profile 与 rawText（编辑器保存/AI 导入后调用）。 */
export async function saveActiveSlotData(
  { profile, rawText }: { profile: ResumeProfile; rawText: string },
  storageOverride?: ChromeStorage
): Promise<void> {
  const state = await loadSlotState(storageOverride)
  const active = state.slots.find((slot) => slot.id === state.activeSlotId)
  if (!active) throw new Error('没有可用的简历档位')

  active.profile = normalizeResumeProfile(profile)
  active.rawText = String(rawText || '')
  active.updatedAt = Date.now()

  const storage = getStorage(storageOverride)
  await storage.local.set({ [RESUME_SLOT_KEYS.slots]: state.slots })
}

/** 仅更新激活档 rawText（PDF 提取后的暂存，不覆盖 profile）。 */
export async function saveActiveSlotRawText(rawText: string, storageOverride?: ChromeStorage): Promise<void> {
  const state = await loadSlotState(storageOverride)
  const active = state.slots.find((slot) => slot.id === state.activeSlotId)
  if (!active) throw new Error('没有可用的简历档位')

  active.rawText = String(rawText || '')
  active.updatedAt = Date.now()

  const storage = getStorage(storageOverride)
  await storage.local.set({ [RESUME_SLOT_KEYS.slots]: state.slots })
}

/** 更新激活档的投递上下文（company/position/name） */
export async function updateActiveSlotMeta(
  meta: { name?: string; company?: string; position?: string },
  storageOverride?: ChromeStorage
): Promise<void> {
  const state = await loadSlotState(storageOverride)
  const active = state.slots.find((slot) => slot.id === state.activeSlotId)
  if (!active) throw new Error('没有可用的简历档位')

  if (meta.name !== undefined) active.name = text(meta.name) || active.name
  if (meta.company !== undefined) active.company = text(meta.company)
  if (meta.position !== undefined) active.position = text(meta.position)
  active.updatedAt = Date.now()

  const storage = getStorage(storageOverride)
  await storage.local.set({ [RESUME_SLOT_KEYS.slots]: state.slots })
}

export async function setActiveSlot(slotId: string, storageOverride?: ChromeStorage): Promise<void> {
  const state = await loadSlotState(storageOverride)
  const target = state.slots.find((slot) => slot.id === slotId)
  if (!target) throw new Error('目标简历档位不存在')

  const storage = getStorage(storageOverride)
  await storage.local.set({ [RESUME_SLOT_KEYS.activeSlotId]: target.id })
}

/** 新增档位并激活（可选复制来源档的数据） */
export async function addSlot(
  options: { name?: string; copyFromId?: string } = {},
  storageOverride?: ChromeStorage
): Promise<ResumeSlot> {
  const state = await loadSlotState(storageOverride)
  const source = options.copyFromId
    ? state.slots.find((slot) => slot.id === options.copyFromId)
    : undefined

  const slot = createSlot(options.name || source?.name || '新档位', {
    profile: source ? JSON.parse(JSON.stringify(source.profile)) : undefined,
    rawText: source?.rawText,
    company: source?.company,
    position: source?.position,
  })

  const storage = getStorage(storageOverride)
  await storage.local.set({
    [RESUME_SLOT_KEYS.slots]: [...state.slots, slot],
    [RESUME_SLOT_KEYS.activeSlotId]: slot.id,
  })
  return slot
}

/** 删除档位（至少保留一档；删激活档则切到剩余第一档） */
export async function removeSlot(slotId: string, storageOverride?: ChromeStorage): Promise<void> {
  const state = await loadSlotState(storageOverride)
  if (state.slots.length <= 1) {
    throw new Error('至少保留一个简历档位')
  }

  const remaining = state.slots.filter((slot) => slot.id !== slotId)
  if (remaining.length === state.slots.length) {
    throw new Error('目标简历档位不存在')
  }

  const storage = getStorage(storageOverride)
  const nextActiveId =
    state.activeSlotId === slotId ? remaining[0].id : state.activeSlotId
  await storage.local.set({
    [RESUME_SLOT_KEYS.slots]: remaining,
    [RESUME_SLOT_KEYS.activeSlotId]: nextActiveId,
  })
}
