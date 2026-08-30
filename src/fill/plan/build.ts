/**
 * AI 规划环：剩余字段（规则环未命中）分批调用 AI 产出决策。
 * 缓存编排与两段执行见 plan-execute.ts；本地防线见 rules.ts。
 */

import { callAI as defaultCallAI } from '@/ai/client'
import { parseJsonFromAiText } from '@/ai/json'
import type { PhaseEvent } from '@/messaging/events'
import type { SendLog } from '../execute/pipeline'
import type { FieldDecision, FieldObservation } from '../types'
import { buildFieldPlanningPayload, normalizeDecisions } from './payload'

export type CallAiFn = typeof defaultCallAI

/** 规划阶段事件出口（阶段视图/aiBatch 批次进度） */
export type EmitPhase = (event: PhaseEvent) => void

/** 单次 AI 规划调用的字段数上限（超限分批，防小上下文模型截断） */
export const MAX_FIELDS_PER_AI_BATCH = 30

export async function planWithAi(
  observations: FieldObservation[],
  resumeProfile: Record<string, unknown>,
  modelId: string,
  {
    sendLog,
    signal,
    onPhase,
    batchSize = MAX_FIELDS_PER_AI_BATCH,
    callAi = defaultCallAI,
    payloadMeta,
  }: {
    sendLog: SendLog
    signal?: AbortSignal
    onPhase?: EmitPhase
    batchSize?: number
    /** 测试注入；缺省走 background 代理的 chrome 消息实现 */
    callAi?: CallAiFn
    /** 载荷的 url/title 来源（缺省 location/document，测试可注入） */
    payloadMeta?: { url: string; title: string }
  }
): Promise<FieldDecision[]> {
  if (observations.length === 0) return []

  const meta = payloadMeta ?? { url: location.href, title: document.title }

  const planBatch = async (batch: FieldObservation[]): Promise<FieldDecision[]> => {
    const promptPayload = buildFieldPlanningPayload(batch, resumeProfile, meta)
    const aiText = await callAi(modelId, JSON.stringify(promptPayload), 'form_planning', { signal })
    const parsed = parseJsonFromAiText(aiText) as { decisions?: unknown; mappings?: unknown }
    return normalizeDecisions(parsed?.decisions ?? parsed?.mappings, batch)
  }

  if (observations.length <= batchSize) {
    onPhase?.({ type: 'phase', phase: 'aiBatch', batch: 1, batches: 1 })
    return planBatch(observations)
  }

  const batches: FieldObservation[][] = []
  for (let start = 0; start < observations.length; start += batchSize) {
    batches.push(observations.slice(start, start + batchSize))
  }

  sendLog('info', `字段较多（${observations.length} 个），分 ${batches.length} 批调用 AI 规划...`)

  const decisions: FieldDecision[] = []
  for (const [index, batch] of batches.entries()) {
    onPhase?.({ type: 'phase', phase: 'aiBatch', batch: index + 1, batches: batches.length })
    sendLog('info', `AI 规划批次 ${index + 1}/${batches.length}（${batch.length} 个字段）...`)
    decisions.push(...(await planBatch(batch)))
  }

  return decisions
}
