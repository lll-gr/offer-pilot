/**
 * 跨上下文消息契约与 content script 版本握手。
 * background ↔ sidepanel ↔ content script 的消息形状都在这里定义，
 * 三端 import 同一份类型，避免字符串协议漂移。
 */

/** content script 版本：content 侧行为变更时 bump，旧脚本 ping 会被判为过期 */
export const CONTENT_SCRIPT_VERSION = '2026-08-28-offer-pilot-v2'

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

export interface StartFillResponse {
  success: boolean
  canceled?: boolean
  message?: string
  fieldCount?: number
  mappedCount?: number
  filledCount?: number
  cacheHit?: boolean
  segmentCount?: number
}

export type TabMessage = StartFillRequest | { action: 'ping' } | { action: 'getStatus' }
export type TabMessageResponse = PingResponse | GetStatusResponse | StartFillResponse

/** content script → background/sidepanel 的运行时通知 */
export type RuntimeNotification =
  | { type: 'log'; level: string; text: string }
  | { type: 'updateStats'; fieldCount: number; mappedCount: number; filledCount: number }
  | { type: 'error'; text: string }

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
