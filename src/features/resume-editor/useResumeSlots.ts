/**
 * 简历档位 hook（简历状态唯一入口）：档位 CRUD + 激活切换 + 激活档 profile/rawText 编辑态。
 * storage.onChanged 同步档位结构变化；本地 dirty 草稿不覆盖。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  RESUME_SLOT_KEYS,
  addSlot,
  loadSlotState,
  removeSlot,
  saveActiveSlotData,
  saveActiveSlotRawText,
  setActiveSlot,
  updateActiveSlotMeta,
} from '@/resume/profiles'
import type { ResumeSlot } from '@/resume/profiles'
import { createEmptyResumeProfile, normalizeResumeProfile } from '@/resume/schema'
import type { ResumeProfile } from '@/resume/schema'

export function useResumeSlots() {
  const [slots, setSlots] = useState<ResumeSlot[]>([])
  const [activeSlotId, setActiveSlotIdState] = useState('')
  const [profile, setProfile] = useState<ResumeProfile>(() => createEmptyResumeProfile())
  const [rawText, setRawText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const dirtyRef = useRef(false)
  const syncingRef = useRef(false)

  const refresh = useCallback(async () => {
    const state = await loadSlotState()
    setSlots(state.slots)
    setActiveSlotIdState(state.activeSlotId)
    setLoaded(true)
    return state
  }, [])

  /** 从激活档重载 profile/rawText（丢弃本地草稿） */
  const load = useCallback(async () => {
    const state = await loadSlotState()
    const active = state.slots.find((slot) => slot.id === state.activeSlotId) ?? state.slots[0]
    setSlots(state.slots)
    setActiveSlotIdState(active.id)
    setProfile(normalizeResumeProfile(active.profile))
    setRawText(active.rawText || '')
    dirtyRef.current = false
    setLoaded(true)
    return { profile: active.profile, rawText: active.rawText || '' }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 档位结构被其他上下文修改（编辑器 ↔ 侧栏）时同步；本地草稿编辑中不覆盖
  useEffect(() => {
    const listener = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string
    ) => {
      if (areaName !== 'local') return
      if (!changes[RESUME_SLOT_KEYS.slots] && !changes[RESUME_SLOT_KEYS.activeSlotId]) return
      if (dirtyRef.current || syncingRef.current) return

      void load()
    }

    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [load])

  const activeSlot = slots.find((slot) => slot.id === activeSlotId) || null

  const runExclusive = useCallback(async (action: () => Promise<void>) => {
    syncingRef.current = true
    try {
      await action()
    } finally {
      syncingRef.current = false
    }
  }, [])

  const switchSlot = useCallback(
    async (slotId: string) => {
      if (slotId === activeSlotId) return
      await runExclusive(async () => {
        await setActiveSlot(slotId)
        await load()
      })
    },
    [activeSlotId, load, runExclusive]
  )

  const createNewSlot = useCallback(
    async (options: { name?: string; copyFromId?: string } = {}) => {
      await runExclusive(async () => {
        await addSlot(options)
        await load()
      })
    },
    [load, runExclusive]
  )

  const deleteSlot = useCallback(
    async (slotId: string) => {
      await runExclusive(async () => {
        await removeSlot(slotId)
        await load()
      })
    },
    [load, runExclusive]
  )

  const saveActive = useCallback(
    async (nextProfile: ResumeProfile, nextRawText: string) => {
      const normalized = normalizeResumeProfile(nextProfile)
      setProfile(normalized)
      setRawText(nextRawText)
      await runExclusive(async () => {
        await saveActiveSlotData({ profile: normalized, rawText: nextRawText })
        await refresh()
      })
      dirtyRef.current = false
    },
    [refresh, runExclusive]
  )

  /** PDF 提取后暂存 rawText（不触保存解锁） */
  const persistRawText = useCallback(
    async (nextRawText: string) => {
      setRawText(nextRawText)
      await runExclusive(async () => {
        await saveActiveSlotRawText(nextRawText)
        await refresh()
      })
    },
    [refresh, runExclusive]
  )

  const updateMeta = useCallback(
    async (meta: { name?: string; company?: string; position?: string }) => {
      await runExclusive(async () => {
        await updateActiveSlotMeta(meta)
        await refresh()
      })
    },
    [refresh, runExclusive]
  )

  const markDirty = useCallback(() => {
    dirtyRef.current = true
  }, [])

  const markClean = useCallback(() => {
    dirtyRef.current = false
  }, [])

  /** 导入流程进行中暂停外部 storage 同步，避免 onChanged 覆盖本地草稿 */
  const setStorageSyncPaused = useCallback((paused: boolean) => {
    syncingRef.current = paused
  }, [])

  return {
    profile,
    rawText,
    loaded,
    load,
    setRawText,
    markDirty,
    markClean,
    setStorageSyncPaused,
    slots,
    activeSlot,
    activeSlotId,
    loading: loaded,
    switchSlot,
    createNewSlot,
    deleteSlot,
    saveActive,
    persistRawText,
    updateMeta,
  }
}
