/**
 * 分步填充的 AI 决策咨询：现场摘要 → prompt → LLM → 归一化决策。
 * 纯函数模块；调用失败由 controller 兜底为「等用户手动操作」。
 */

export type SegmentDecisionAction = 'click' | 'wait' | 'stop' | 'ask_human'

export interface SegmentDecision {
  action: SegmentDecisionAction
  /** action === 'click' 时的候选下标（已校验合法） */
  buttonIndex: number
  reason: string
}

export interface DecisionContext {
  segmentIndex: number
  segmentTotal: number
  lastSegmentLabels: string[]
  candidates: { text: string }[]
  newFieldLabels?: string[]
  anomaly?: string
}

const MAX_LABELS = 30

function clipLabels(labels: string[] | undefined): string[] {
  return (labels || []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, MAX_LABELS)
}

export function buildDecisionPrompt(ctx: DecisionContext): string {
  return JSON.stringify({
    segmentIndex: Number(ctx?.segmentIndex) || 0,
    segmentTotal: Number(ctx?.segmentTotal) || 0,
    lastSegmentLabels: clipLabels(ctx?.lastSegmentLabels),
    candidates: (ctx?.candidates || []).map((item) => ({ text: String(item?.text || '').trim() })).slice(0, 20),
    newFieldLabels: clipLabels(ctx?.newFieldLabels),
    anomaly: String(ctx?.anomaly || '').trim() || undefined,
  })
}

const VALID_ACTIONS: SegmentDecisionAction[] = ['click', 'wait', 'stop', 'ask_human']

export function normalizeDecisionResponse(raw: unknown, candidateCount: number): SegmentDecision {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  const action = record.action as SegmentDecisionAction
  const reason = String(record.reason || '').trim().slice(0, 200)

  if (!VALID_ACTIONS.includes(action)) {
    return { action: 'ask_human', buttonIndex: -1, reason: reason || 'AI 返回了未知的动作类型' }
  }

  if (action === 'click') {
    const index = Number(record.buttonIndex)
    // 越界/非法下标回退 ask_human：宁可不点也不点错
    if (!Number.isInteger(index) || index < 0 || index >= candidateCount) {
      return { action: 'ask_human', buttonIndex: -1, reason: reason || 'AI 指定的按钮下标无效' }
    }
    return { action, buttonIndex: index, reason }
  }

  return { action, buttonIndex: -1, reason }
}
