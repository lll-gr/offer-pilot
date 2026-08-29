/**
 * 配置导出/导入：模型配置 + 简历档位 + 应用设置 一键迁移。
 * 不含决策缓存（可重建）与临时状态（更新检查节流时间戳）。
 * 导出文件为纯 JSON，用户自管；导入数据全部走各自归一化（非法字段丢弃）。
 */

import {
  loadModelState,
  MODEL_STORAGE_KEYS,
  normalizeModels,
  saveModelState,
  saveActiveModelId,
} from '@/models/storage'
import {
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_KEY,
} from '@/settings/storage'
import { RESUME_SLOT_KEYS } from '@/resume/profiles'
import type { ResumeSlot } from '@/resume/profiles'
import { normalizeResumeProfile } from '@/resume/schema'

export interface ExportedConfigData {
  models: Array<Record<string, unknown>>
  activeModelId: string
  resumeSlots: ResumeSlot[]
  resumeActiveSlotId: string
  settings: Record<string, unknown>
}

export interface ExportedConfig {
  format: 'offer-pilot-config'
  version: 1
  exportedAt: string
  data: ExportedConfigData
}

interface AreaLike {
  get: (keys: string[]) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

function getStorage(): AreaLike | null {
  const globalChrome = typeof chrome !== 'undefined' ? (chrome as { storage?: { local?: AreaLike } }) : undefined
  return globalChrome?.storage?.local ?? null
}

export async function exportConfig(): Promise<ExportedConfig> {
  const storage = getStorage()
  if (!storage) throw new Error('扩展本地存储不可用')

  const [modelState, resumeData, settings] = await Promise.all([
    loadModelState(),
    storage.get([RESUME_SLOT_KEYS.slots, RESUME_SLOT_KEYS.activeSlotId]),
    loadSettings(),
  ])

  const resumeSlots = Array.isArray(resumeData[RESUME_SLOT_KEYS.slots])
    ? (resumeData[RESUME_SLOT_KEYS.slots] as ResumeSlot[])
    : []

  return {
    format: 'offer-pilot-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      models: modelState.models as unknown as Array<Record<string, unknown>>,
      activeModelId: modelState.activeModelId,
      resumeSlots,
      resumeActiveSlotId: String(resumeData[RESUME_SLOT_KEYS.activeSlotId] || ''),
      settings: settings as unknown as Record<string, unknown>,
    },
  }
}

/** 校验导出文件结构（弱校验：格式标记 + 数据字段存在即可，字段级合法性由各归一化器兜底） */
export function parseImportedConfig(text: string): ExportedConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }

  const record = parsed as Partial<ExportedConfig> & { data?: Partial<ExportedConfig['data']> }
  if (record?.format !== 'offer-pilot-config' || !record.data || typeof record.data !== 'object') {
    throw new Error('不是 Offer Pilot 配置文件（缺少格式标识）')
  }

  return {
    format: 'offer-pilot-config',
    version: 1,
    exportedAt: String(record.exportedAt || ''),
    data: {
      models: Array.isArray(record.data.models) ? record.data.models : [],
      activeModelId: String(record.data.activeModelId || ''),
      resumeSlots: Array.isArray(record.data.resumeSlots) ? record.data.resumeSlots : [],
      resumeActiveSlotId: String(record.data.resumeActiveSlotId || ''),
      settings: record.data.settings && typeof record.data.settings === 'object' ? record.data.settings : {},
    },
  }
}

/** 导入（覆盖语义）：写入前全部过归一化；storage.onChanged 自动驱动已打开页面刷新 */
export async function importConfig(config: ExportedConfig): Promise<{
  modelCount: number
  slotCount: number
}> {
  const storage = getStorage()
  if (!storage) throw new Error('扩展本地存储不可用')

  // 模型：normalizeModels 去重/清洗；激活 id 失效时由 loadModelState 兜底回退
  const models = normalizeModels(config.data.models)
  await saveModelState({ models })
  await saveActiveModelId(config.data.activeModelId || models[0]?.id || '')

  // 简历档位：逐档归一化 profile，保结构字段
  const slots: ResumeSlot[] = []
  for (const raw of config.data.resumeSlots) {
    const slot = raw as Partial<ResumeSlot>
    if (!slot?.id) continue
    slots.push({
      id: String(slot.id),
      name: String(slot.name || '未命名档位'),
      company: String(slot.company || ''),
      position: String(slot.position || ''),
      profile: normalizeResumeProfile(slot.profile),
      rawText: String(slot.rawText || ''),
      createdAt: Number(slot.createdAt) || Date.now(),
      updatedAt: Date.now(),
    })
  }
  if (slots.length > 0) {
    const activeId = config.data.resumeActiveSlotId
    await storage.set({
      [RESUME_SLOT_KEYS.slots]: slots,
      [RESUME_SLOT_KEYS.activeSlotId]: slots.some((slot) => slot.id === activeId)
        ? activeId
        : slots[0].id,
    })
  }

  // 应用设置
  await saveSettings(normalizeSettings(config.data.settings))

  return { modelCount: models.length, slotCount: slots.length }
}

/** 触发浏览器下载导出文件 */
export function downloadConfigFile(config: ExportedConfig): void {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `offer-pilot-config-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

// 供测试注入的存储键集合导出
export { MODEL_STORAGE_KEYS, SETTINGS_KEY }
