/**
 * 跨上下文消息契约与 content script 版本握手。
 * background ↔ sidepanel ↔ content script 的消息形状都在这里定义，
 * 三端 import 同一份类型，避免字符串协议漂移。
 */

/** content script 版本：content 侧行为变更时 bump，旧脚本 ping 会被判为过期 */
export const CONTENT_SCRIPT_VERSION = '2026-08-30-offer-pilot-v5'

/** 字段映射缓存的 storage key（popup 清理按钮与 content 读写共用） */
export const MAPPING_CACHE_KEY = 'fieldMappingCacheV3'

export interface PingResponse {
  success: true
  version: string
  capabilities: { fullDiagnostics: boolean }
}

export interface GetStatusResponse {
  success: true
  fieldCount: number
  mappedCount: number
  filledCount: number
}

export interface StartFillRequest {
  action: 'startFill'
  modelId: string
  resumeProfile: Record<string, unknown>
  fillMode: 'overwrite' | 'incremental' | 'segmented'
  scope: 'page' | 'selection'
}

/** 填充结束后的字段级结果汇总（决策透明化：UI 展示待人工/保留/失败清单） */
export interface FillFieldReport {
  fieldId: string
  label: string
  outcome: 'filled' | 'kept' | 'manual' | 'skipped' | 'failed'
  verified: boolean
  message?: string
}

export interface StartFillResponse {
  success: boolean
  canceled?: boolean
  message?: string
  fieldCount?: number
  mappedCount?: number
  filledCount?: number
  cacheHit?: boolean
  segmentCount?: number
  /** 待人工处理（AI 判 manual/低置信度/敏感）与失败字段的清单 */
  fieldReport?: FillFieldReport[]
}

export type TabMessage =
  | StartFillRequest
  | { action: 'ping' }
  | { action: 'getStatus' }
  | { action: 'cancelFill' }
  | { action: 'collectFilledFields' }
export type TabMessageResponse = PingResponse | GetStatusResponse | StartFillResponse | CollectFilledFieldsResponse | { success: boolean; canceled: boolean }

/** 页面回填简历：content 侧收集的已填字段快照单元（值原样取自页面，AI 不产出值） */
export interface FilledFieldSnapshot {
  fieldId: string
  kind: string
  label: string
  placeholder: string
  context: string
  sectionLabel: string
  nearbyLabels: string[]
  options: string[]
  value: string
}

export interface CollectFilledFieldsResponse {
  success: boolean
  fields: FilledFieldSnapshot[]
  message?: string
}

// 通知事件契约见 ./events.ts（FillEvent 单一真源）

/** sidepanel → background 的 AI 调用请求 */
export interface CallAiRequest {
  action: 'callAI'
  modelId: string
  prompt: string
  mode: string
}

export function isCallAiRequest(message: unknown): message is CallAiRequest {
  if (!message || typeof message !== 'object') return false
  const record = message as Record<string, unknown>
  return record.action === 'callAI' && typeof record.prompt === 'string' && typeof record.mode === 'string'
}

export interface CallAiResponse {
  success: boolean
  data?: string
  error?: string
}

/** 校验 ping 响应是否来自当前版本的 content script */
export function contentScriptHasDiagnosticsSupport(status: unknown): boolean {
  const candidate = status as Partial<PingResponse> | null
  return Boolean(
    candidate?.success === true &&
      candidate?.version === CONTENT_SCRIPT_VERSION &&
      candidate?.capabilities?.fullDiagnostics === true,
  )
}
