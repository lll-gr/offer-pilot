/**
 * 分步推进决策：责任链模式。
 * 每个决策器是一个「试答」函数——能决策就返回 verdict，答不了返回 null 交给下一环。
 * 链序即成本序：规则（零成本）→ AI 咨询 → 人工兜底（永不失败）。
 *
 * 与填充策略注册表（strategies.ts）的区别：FieldKind 是开放集合（新控件持续出现，
 * 适合 Record 注册表）；推进决策是封闭的降级链，适合责任链。
 */

import { callAI } from '@/ai/client'
import { parseJsonFromAiText } from '@/ai/json'
import { clickLikeUser } from './execute/dom'
import { buildDecisionPrompt, normalizeDecisionResponse } from './decision'
import type { DecisionContext, SegmentDecision } from './decision'
import type { NextStepCandidate } from './segments'

export interface AdvanceContext {
  ctx: DecisionContext
  /** 全部候选（含 submit 语义；规则环只消费 advance 子集，AI 环看全列表） */
  candidates: NextStepCandidate[]
  modelId: string
  sendLog: (level: string, text: string) => void
  signal?: AbortSignal
}

export type AdvanceVerdict =
  | { kind: 'clicked'; via: 'rule' | 'ai'; button: string }
  | { kind: 'stop'; reason: string }
  | { kind: 'wait'; reason: string }
  | { kind: 'ask_human'; reason: string }

export type AdvanceDecider = (deps: AdvanceContext) => Promise<AdvanceVerdict | null>

// ---------------------------------------------------------------------------
// 第 1 环：规则——唯一「推进语义」候选直接点（零成本，永不调 AI）
// ---------------------------------------------------------------------------

const ruleDecider: AdvanceDecider = async ({ candidates, sendLog }) => {
  // 红线：提交语义按钮（提交/保存/确认）不参与自动点击，只能由用户手动点
  const advanceCandidates = candidates.filter((item) => item.semantic === 'advance')
  if (advanceCandidates.length !== 1) return null

  sendLog('info', `检测到唯一推进按钮「${advanceCandidates[0].text}」，代为点击。`)
  clickLikeUser(advanceCandidates[0].el)
  return { kind: 'clicked', via: 'rule', button: advanceCandidates[0].text }
}

// ---------------------------------------------------------------------------
// 第 2 环：AI 咨询——歧义场景（0 或 ≥2 推进候选）花一次调用拿决策
// ---------------------------------------------------------------------------

const aiDecider: AdvanceDecider = async ({ ctx, modelId, sendLog, signal }) => {
  try {
    const prompt = buildDecisionPrompt(ctx)
    const aiText = await callAI(modelId, prompt, 'segment_decision', { signal })
    const decision = normalizeDecisionResponse(parseJsonFromAiText(aiText), (ctx.candidates || []).length)
    sendLog(
      'info',
      `[AI决策] ${decision.action}${decision.buttonIndex >= 0 ? ` #${decision.buttonIndex}` : ''}：${decision.reason || '（无理由）'}`,
    )
    return toVerdict(decision, sendLog)
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw error
    }
    sendLog('warning', `AI 决策咨询失败（${(error as Error).message}），回退为等待人工操作。`)
    return null // 答不了 → 下一环
  }
}

/**
 * AI 决策 → verdict。click 的执行权收归规则环之外的唯一出口：
 * AI 只负责「建议」，红线下点击语义按钮必须由规则环或用户执行——
 * 因此 AI 的 click 一律转为带建议理由的 ask_human（提示用户照建议手点）。
 * 这同时修复了 buttonIndex 语义错位（AI 按全列表计数）。
 */
function toVerdict(decision: SegmentDecision, sendLog: (level: string, text: string) => void): AdvanceVerdict | null {
  if (decision.action === 'stop') {
    return { kind: 'stop', reason: decision.reason }
  }

  if (decision.action === 'wait') {
    return { kind: 'wait', reason: decision.reason }
  }

  if (decision.action === 'click') {
    // AI 建议点击：不代点（索引语义 + 红线双重原因），转人工并附建议
    sendLog('info', `AI 建议点击候选 #${decision.buttonIndex}，请确认后手动点击。`)
    return { kind: 'ask_human', reason: `AI 建议点击 #${decision.buttonIndex}（${decision.reason}）` }
  }

  return null // ask_human → 下一环（人工兜底统一话术）
}

// ---------------------------------------------------------------------------
// 第 3 环：人工兜底——永不失败，等用户手动操作
// ---------------------------------------------------------------------------

const humanFallbackDecider: AdvanceDecider = async () => ({
  kind: 'ask_human',
  reason: '无可自动执行的推进决策',
})

// ---------------------------------------------------------------------------
// 链组装与入口
// ---------------------------------------------------------------------------

/** 决策链：顺序即优先级，前一环返回 null 才轮到下一环 */
const ADVANCE_DECIDERS: AdvanceDecider[] = [ruleDecider, aiDecider, humanFallbackDecider]

/**
 * 执行推进决策链。verdict 由调用方解释：
 * clicked→继续等翻页；stop→终止流程；wait→延长等待；ask_human→提示用户手动点。
 */
export async function decideAdvance(deps: AdvanceContext): Promise<AdvanceVerdict> {
  for (const decider of ADVANCE_DECIDERS) {
    const verdict = await decider(deps)
    if (verdict) return verdict
  }
  // 理论不可达（humanFallback 永不返回 null），防御性兜底
  return { kind: 'ask_human', reason: '决策链意外终止' }
}
