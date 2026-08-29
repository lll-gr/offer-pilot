/**
 * 本地决策防线：AI/缓存决策与现场观察矛盾时的语义纠正。
 * 规则独立于 AI 可单测；缓存重放的决策同样过防线（现场可能已变）。
 */

import type { FieldDecision, FieldObservation } from '../types'

/**
 * 高敏字段：错填代价高（表单直接作废/隐私泄露），一律交人工确认。
 * 清单对齐 RESUME_SKILL：身份证件 + 政治面貌 + 紧急联系人 + 银行卡 + 社保 + 住址族。
 * 地址用「限定前缀 + 地址」匹配，避免误伤「GitHub 地址/项目地址」类字段。
 */
const SENSITIVE_IDENTITY_PATTERN =
  /(身份证|证件号码|身份证号|护照|passport\s*no|id\s*card\s*no|政治面貌|紧急联系人|银行卡|社保|住址|(家庭|现居|居住|详细|通讯|通信|邮寄)地址)/i

export function applyDecisionRules(
  decision: FieldDecision,
  observation: FieldObservation
): FieldDecision {
  let next: FieldDecision = { ...decision }
  const hasResumePath = Boolean(next.resumePath?.trim())

  // 动作与现场矛盾纠正
  if (next.action === 'keep' && !observation.hasValue) {
    next = {
      ...next,
      action: hasResumePath ? 'fill' : 'skip',
      reason: `${next.reason}（本地纠正：字段当前为空，keep 无意义）`,
    }
  }

  if ((next.action === 'fill' || next.action === 'correct') && !hasResumePath) {
    next = { ...next, action: 'skip' }
  }

  if (next.action === 'correct' && !observation.hasValue) {
    next = { ...next, action: 'fill' }
  }

  // 敏感身份字段强制人工
  if (next.action === 'fill' || next.action === 'correct') {
    const identityText = [
      observation.descriptor.label,
      observation.descriptor.name,
      observation.descriptor.id,
    ].join(' ')
    if (SENSITIVE_IDENTITY_PATTERN.test(identityText)) {
      next = {
        ...next,
        action: 'manual',
        reason: `${next.reason}（本地防线：身份证件类字段交人工确认）`,
      }
    }
  }

  // 低置信度防线：AI 自认把握很小的 fill/correct 交人工，宁可不填不错填
  if ((next.action === 'fill' || next.action === 'correct') && next.confidence === 'low') {
    next = {
      ...next,
      action: 'manual',
      reason: `${next.reason}（本地防线：AI 置信度 low，交人工确认）`,
    }
  }

  return next
}

export function refinePlan(
  decisions: FieldDecision[],
  observations: FieldObservation[]
): FieldDecision[] {
  const observationById = new Map(
    observations.map((observation) => [observation.descriptor.fieldId, observation]),
  )
  return decisions.map((decision) => {
    const observation = observationById.get(decision.fieldId)
    return observation ? applyDecisionRules(decision, observation) : decision
  })
}
