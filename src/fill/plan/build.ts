/**
 * 规划编排（责任链）：规则环（autocomplete 确定性）→ 缓存/AI 环 → 本地防线。
 * 规则命中的字段不再进入 AI 载荷（省 token）；AI 环字段数超阈值时分批调用。
 * 主流程与分块流程的每块复用，不含编排状态；执行见 execute/pipeline.ts。
 */

import { callAI } from '@/ai/client'
import { parseJsonFromAiText } from '@/ai/json'
import type { PhaseEvent } from '@/messaging/events'
import type { SendLog } from '../execute/pipeline'
import type { FieldDecision, FieldObservation } from '../types'
import {
  alignCachedDecisions,
  createFieldKey,
  createMappingCacheKeyFromSignature,
  createMappingCacheSignature,
  loadMappingCacheEntry,
  saveMappingCacheEntry,
} from './cache'
import { buildFieldPlanningPayload, normalizeDecisions } from './payload'
import { planByRules } from './rule-planner'
import { refinePlan } from './rules'

export interface PlanOutcome {
  plan: FieldDecision[]
  cacheHit: boolean
}

/** 规划阶段事件出口（阶段视图/aiBatch 批次进度） */
export type EmitPhase = (event: PhaseEvent) => void

/** 单次 AI 规划调用的字段数上限（超限分批，防小上下文模型截断） */
const MAX_FIELDS_PER_AI_BATCH = 30

async function planWithAi(
  observations: FieldObservation[],
  resumeProfile: Record<string, unknown>,
  modelId: string,
  { sendLog, signal, onPhase }: { sendLog: SendLog; signal?: AbortSignal; onPhase?: EmitPhase }
): Promise<FieldDecision[]> {
  if (observations.length === 0) return []

  if (observations.length <= MAX_FIELDS_PER_AI_BATCH) {
    onPhase?.({ type: 'phase', phase: 'aiBatch', batch: 1, batches: 1 })
    const promptPayload = buildFieldPlanningPayload(observations, resumeProfile, {
      url: location.href,
      title: document.title,
    })
    const aiText = await callAI(modelId, JSON.stringify(promptPayload), 'form_planning', { signal })
    const parsed = parseJsonFromAiText(aiText) as { decisions?: unknown; mappings?: unknown }
    return normalizeDecisions(parsed?.decisions ?? parsed?.mappings, observations)
  }

  const batches: FieldObservation[][] = []
  for (let start = 0; start < observations.length; start += MAX_FIELDS_PER_AI_BATCH) {
    batches.push(observations.slice(start, start + MAX_FIELDS_PER_AI_BATCH))
  }

  sendLog('info', `字段较多（${observations.length} 个），分 ${batches.length} 批调用 AI 规划...`)

  const decisions: FieldDecision[] = []
  for (const [index, batch] of batches.entries()) {
    onPhase?.({ type: 'phase', phase: 'aiBatch', batch: index + 1, batches: batches.length })
    sendLog('info', `AI 规划批次 ${index + 1}/${batches.length}（${batch.length} 个字段）...`)
    const promptPayload = buildFieldPlanningPayload(batch, resumeProfile, {
      url: location.href,
      title: document.title,
    })
    const aiText = await callAI(modelId, JSON.stringify(promptPayload), 'form_planning', { signal })
    const parsed = parseJsonFromAiText(aiText) as { decisions?: unknown; mappings?: unknown }
    decisions.push(...normalizeDecisions(parsed?.decisions ?? parsed?.mappings, batch))
  }

  return decisions
}

export async function buildFillPlan(
  observations: FieldObservation[],
  resumeProfile: Record<string, unknown>,
  modelId: string,
  { sendLog, signal, onPhase }: { sendLog: SendLog; signal?: AbortSignal; onPhase?: EmitPhase }
): Promise<PlanOutcome> {
  const fields = observations.map((observation) => observation.descriptor)

  onPhase?.({ type: 'phase', phase: 'planning' })

  // --- 责任链第一环：规则规划（确定性，零 token） ---
  const { decisions: ruleDecisions, remaining } = planByRules(observations, resumeProfile)
  if (ruleDecisions.length > 0) {
    sendLog('info', `规则环确定性命中 ${ruleDecisions.length} 个字段（autocomplete/name），跳过 AI。`)
  }

  let aiDecisions: FieldDecision[] = []
  let cacheHit = false

  // --- 责任链第二环：缓存/AI（仅处理规则未命中的字段） ---
  if (remaining.length > 0) {
    const remainingFields = remaining.map((observation) => observation.descriptor)
    const cacheSignature = createMappingCacheSignature(fields)
    const cacheKey = createMappingCacheKeyFromSignature(cacheSignature, {
      origin: location.origin,
      pathname: location.pathname,
      host: location.host,
    })

    const cacheLookup = await loadMappingCacheEntry(cacheKey, {
      host: location.host,
      path: location.pathname,
      signature: cacheSignature,
    })

    if (cacheLookup.entry?.decisions?.length) {
      // 重放对齐：按字段指纹把缓存决策安到当前扫描字段（序号无关），再过本地防线
      const aligned = alignCachedDecisions(cacheLookup.entry.decisions, remainingFields)
      aiDecisions = normalizeDecisions(aligned, remaining)
      cacheHit = true
      sendLog(
        'info',
        `已命中本地填表决策缓存（${aiDecisions.length}/${cacheLookup.entry.decisions.length} 条按指纹对齐），跳过模型调用。`,
      )
    } else {
      sendLog('info', `[缓存] 未命中 reason="${cacheLookup.reason || '未知原因'}"`)
      sendLog('info', `已识别 ${remaining.length} 个待规划字段，正在调用 AI 制定填充计划...`)

      aiDecisions = await planWithAi(remaining, resumeProfile, modelId, { sendLog, signal, onPhase })

      // 写缓存：规则环与 AI 环的决策合并后统一落盘，下次整页重放
      const mergedForCache = [...ruleDecisions, ...aiDecisions].map((decision) => {
        const observation = observations.find(
          (item) => item.descriptor.fieldId === decision.fieldId,
        )
        return observation ? { ...decision, fieldKey: createFieldKey(observation.descriptor) } : decision
      })

      await saveMappingCacheEntry(cacheKey, {
        updatedAt: Date.now(),
        decisions: mergedForCache,
        host: location.host,
        path: location.pathname,
        signature: cacheSignature,
      })

      sendLog('success', '填充计划已生成，并已写入本地缓存。')
    }
  }

  // --- 责任链第三环：本地防线（矛盾纠正/敏感降级/低置信度降级） ---
  const plan = refinePlan([...ruleDecisions, ...aiDecisions], observations)
  return { plan, cacheHit }
}
