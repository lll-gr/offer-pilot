import { describe, expect, it } from 'vitest'

import {
  RESUME_SLOT_KEYS,
  addSlot,
  createSlot,
  getActiveSlot,
  loadSlotState,
  removeSlot,
  saveActiveSlotData,
  saveActiveSlotRawText,
  saveSlotState,
  setActiveSlot,
  updateActiveSlotMeta,
} from './profiles'
import { createEmptyResumeProfile } from './schema'

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

describe('createSlot', () => {
  it('creates a slot with defaults', () => {
    const slot = createSlot()
    expect(slot.id).toMatch(/^slot-/)
    expect(slot.name).toBe('默认档')
    expect(slot.profile).toEqual(createEmptyResumeProfile())
    expect(slot.company).toBe('')
    expect(slot.position).toBe('')
    expect(slot.createdAt).toBeGreaterThan(0)
  })

  it('applies overrides but keeps generated id', () => {
    const slot = createSlot('字节-后端', { company: '字节跳动', position: '后端工程师' })
    expect(slot.name).toBe('字节-后端')
    expect(slot.company).toBe('字节跳动')
    expect(slot.position).toBe('后端工程师')
  })
})

describe('loadSlotState', () => {
  it('creates a default slot lazily when storage is empty', async () => {
    const { storage, state } = createFakeStorage()
    const result = await loadSlotState(storage)

    expect(result.slots).toHaveLength(1)
    expect(result.activeSlotId).toBe(result.slots[0].id)
    expect(state[RESUME_SLOT_KEYS.slots]).toHaveLength(1)
  })

  it('falls back to first slot when activeSlotId is stale', async () => {
    const { storage } = createFakeStorage()
    const first = await loadSlotState(storage)
    const slotA = first.slots[0]
    await addSlot({ name: 'B' }, storage)
    // 手动写坏 activeId
    await storage.local.set({ [RESUME_SLOT_KEYS.activeSlotId]: 'not-exist' })

    const result = await loadSlotState(storage)
    expect(result.activeSlotId).toBe(slotA.id)
  })
})

describe('slot CRUD round-trip', () => {
  it('saves and loads slots via storage DI', async () => {
    const { storage } = createFakeStorage()
    const slotA = createSlot('A')
    const slotB = createSlot('B')

    await saveSlotState({ slots: [slotA, slotB], activeSlotId: slotB.id }, storage)
    const result = await loadSlotState(storage)

    expect(result.slots.map((slot) => slot.id)).toEqual([slotA.id, slotB.id])
    expect(result.activeSlotId).toBe(slotB.id)
  })

  it('switches active slot', async () => {
    const { storage } = createFakeStorage()
    await addSlot({ name: 'A' }, storage)
    const slotB = await addSlot({ name: 'B' }, storage)
    await setActiveSlot(slotB.id, storage)

    const active = await getActiveSlot(storage)
    expect(active?.id).toBe(slotB.id)
  })

  it('saves active slot data and only writes slot keys', async () => {
    const { storage, state } = createFakeStorage()
    const profile = createEmptyResumeProfile()
    profile.personal = { ...profile.personal, fullName: '张三' }

    await saveActiveSlotData({ profile, rawText: '原始文本' }, storage)

    const active = await getActiveSlot(storage)
    expect((active?.profile.personal as Record<string, string>)?.fullName).toBe('张三')
    expect(active?.rawText).toBe('原始文本')
    // 单一真源：不产生镜像 key
    expect(state.resumeProfile).toBeUndefined()
    expect(state.resumeImportRawText).toBeUndefined()
  })

  it('persists rawText only without touching profile', async () => {
    const { storage } = createFakeStorage()
    const profile = createEmptyResumeProfile()
    profile.personal = { ...profile.personal, fullName: '李四' }
    await saveActiveSlotData({ profile, rawText: '旧文本' }, storage)

    await saveActiveSlotRawText('PDF 提取文本', storage)

    const active = await getActiveSlot(storage)
    expect(active?.rawText).toBe('PDF 提取文本')
    expect((active?.profile.personal as Record<string, string>)?.fullName).toBe('李四')
  })

  it('removes slot and falls back active to first remaining', async () => {
    const { storage } = createFakeStorage()
    const initial = await loadSlotState(storage)
    const defaultSlot = initial.slots[0]
    await addSlot({ name: 'A' }, storage)
    const slotB = await addSlot({ name: 'B' }, storage)

    // 当前激活 B，删除 B 应回退到 remaining[0]（即惰性默认档）
    await removeSlot(slotB.id, storage)
    const active = await getActiveSlot(storage)
    expect(active?.id).toBe(defaultSlot.id)

    // 仅剩两档，删除后再删到一档时禁止
    await removeSlot(defaultSlot.id, storage)
    await expect(removeSlot(slotB.id, storage)).rejects.toThrow('至少保留一个')
  })

  it('copies data from source slot when adding', async () => {
    const { storage } = createFakeStorage()
    const slotA = await addSlot({ name: 'A' }, storage)
    await updateActiveSlotMeta({ company: '字节', position: '后端' }, storage)

    const copied = await addSlot({ name: 'A-复制', copyFromId: slotA.id }, storage)
    expect(copied.company).toBe('字节')
    expect(copied.position).toBe('后端')
    expect(copied.id).not.toBe(slotA.id)

    const active = await getActiveSlot(storage)
    expect(active?.id).toBe(copied.id)
  })
})
