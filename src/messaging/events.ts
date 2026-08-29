/**
 * 填充事件契约（content script → sidepanel 单向推送）。
 *
 * 设计原则：
 * - 这是扩展**内部遥测事件**，只驱动侧栏 UI 状态（日志流/实时进度/填充报告）
 *   与页面内高亮，永远不会触发 chrome.notifications 系统通知打扰用户。
 * - 判别联合 + 类型守卫；事件形状在三端（content/sidepanel/test）共享这一份定义。
 * - 零依赖叶子模块，任何层都可安全 import。
 */

export type LogLevel = 'info' | 'success' | 'warning' | 'error'

export type FieldProgressStatus = 'pending' | 'filled' | 'kept' | 'manual' | 'skipped' | 'failed'

/** 填充生命周期阶段（进度面板的阶段视图；aiBatch 附带批次进度） */
export type FillPhase =
  | 'selection' // 等待用户在页面上拖选区域
  | 'expanding' // 深度扫描：展开可展开区块
  | 'scanning' // 扫描表单字段
  | 'planning' // 生成填充计划（缓存/规则/AI 前置）
  | 'aiBatch' // AI 分批规划中
  | 'executing' // 逐字段执行

export interface LogEvent {
  type: 'log'
  level: LogLevel
  text: string
}

export interface ErrorEvent {
  type: 'error'
  text: string
}

export interface StatsEvent {
  type: 'stats'
  fieldCount: number
  mappedCount: number
  filledCount: number
}

export interface PhaseEvent {
  type: 'phase'
  phase: FillPhase
  /** aiBatch 阶段的批次进度（1-based） */
  batch?: number
  batches?: number
}

export interface FieldProgressEvent {
  type: 'fieldProgress'
  fieldId: string
  label: string
  /** pending=开始处理；其余为终态 */
  status: FieldProgressStatus
  verified?: boolean
  message?: string
  processed: number
  total: number
}

export type FillEvent = LogEvent | ErrorEvent | StatsEvent | PhaseEvent | FieldProgressEvent

const EVENT_TYPES = new Set(['log', 'error', 'stats', 'phase', 'fieldProgress'])

/** 运行时消息收窄守卫（订阅端唯一入口） */
export function isFillEvent(message: unknown): message is FillEvent {
  if (!message || typeof message !== 'object') return false
  return EVENT_TYPES.has(String((message as { type?: unknown }).type))
}
