import { describe, expect, it } from 'vitest'

import { applyDecisionRules, refinePlan } from './rules'
import type { FieldDecision, FieldDescriptor, FieldObservation } from '../types'

function descriptor(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    fieldId: 'f_1',
    kind: 'text',
    label: '姓名',
    name: '',
    id: '',
    placeholder: '',
    options: [],
    required: false,
    context: '',
    sectionKey: '',
    sectionLabel: '',
    sectionEvidence: '',
    nearbyLabels: [],
    ...overrides,
  }
}

function observation(hasValue: boolean, descriptorOverrides: Partial<FieldDescriptor> = {}): FieldObservation {
  return {
    descriptor: descriptor(descriptorOverrides),
    runtime: hasValue
      ? { fieldId: 'f_1', kind: 'text', el: { value: 'x' } as unknown as HTMLInputElement }
      : undefined,
    currentValue: hasValue ? 'x' : '',
    hasValue,
  }
}

function decision(overrides: Partial<FieldDecision> = {}): FieldDecision {
  return {
    fieldId: 'f_1',
    action: 'fill',
    resumePath: 'personal.fullName',
    reason: 'AI 判定',
    transform: { type: 'none' },
    ...overrides,
  }
}

describe('applyDecisionRules', () => {
  it('downgrades keep on empty field to fill when mapped', () => {
    const next = applyDecisionRules(decision({ action: 'keep' }), observation(false))
    expect(next.action).toBe('fill')
    expect(next.reason).toContain('本地纠正')
  })

  it('downgrades keep on empty unmapped field to skip', () => {
    const next = applyDecisionRules(decision({ action: 'keep', resumePath: '' }), observation(false))
    expect(next.action).toBe('skip')
  })

  it('keeps keep when field already has a value', () => {
    const next = applyDecisionRules(decision({ action: 'keep' }), observation(true))
    expect(next.action).toBe('keep')
  })

  it('downgrades fill/correct without resumePath to skip', () => {
    expect(applyDecisionRules(decision({ resumePath: '' }), observation(true)).action).toBe('skip')
    expect(
      applyDecisionRules(decision({ action: 'correct', resumePath: '' }), observation(true)).action,
    ).toBe('skip')
  })

  it('downgrades correct on empty field to fill', () => {
    const next = applyDecisionRules(decision({ action: 'correct' }), observation(false))
    expect(next.action).toBe('fill')
  })

  it('forces identity-number fields to manual', () => {
    const next = applyDecisionRules(
      decision({ resumePath: 'personal.idNumber' }),
      observation(true, { label: '身份证号码' }),
    )
    expect(next.action).toBe('manual')
    expect(next.reason).toContain('本地防线')

    const passport = applyDecisionRules(decision(), observation(false, { label: '护照号' }))
    expect(passport.action).toBe('manual')
  })

  it('forces expanded sensitive fields to manual', () => {
    for (const label of ['政治面貌', '紧急联系人电话', '银行卡号', '社保账号', '家庭住址', '现居住详细地址', '护照号码']) {
      const next = applyDecisionRules(decision(), observation(true, { label }))
      expect(next.action, `label=${label}`).toBe('manual')
    }
  })

  it('does not treat ordinary address or location fields as sensitive', () => {
    expect(applyDecisionRules(decision(), observation(true, { label: '期望工作城市' })).action).toBe('fill')
    expect(applyDecisionRules(decision(), observation(true, { label: '现居城市' })).action).toBe('fill')
    expect(applyDecisionRules(decision(), observation(true, { label: 'GitHub 地址' })).action).toBe('fill')
    expect(applyDecisionRules(decision(), observation(true, { name: 'mailingCity' })).action).toBe('fill')
  })

  it('does not touch skip/manual decisions on sensitive fields', () => {
    expect(
      applyDecisionRules(decision({ action: 'skip', resumePath: '' }), observation(true, { label: '身份证号码' })).action,
    ).toBe('skip')
    expect(
      applyDecisionRules(decision({ action: 'manual' }), observation(true, { label: '身份证号码' })).action,
    ).toBe('manual')
  })

  it('leaves ordinary fields untouched', () => {
    const next = applyDecisionRules(decision(), observation(true))
    expect(next).toEqual(decision())
  })

  it('downgrades low-confidence fill/correct to manual', () => {
    const next = applyDecisionRules(decision({ confidence: 'low' }), observation(true))
    expect(next.action).toBe('manual')
    expect(next.reason).toContain('置信度 low')

    const corrected = applyDecisionRules(decision({ action: 'correct', confidence: 'low' }), observation(true))
    expect(corrected.action).toBe('manual')
  })

  it('keeps medium/high confidence decisions as-is', () => {
    expect(applyDecisionRules(decision({ confidence: 'high' }), observation(true)).action).toBe('fill')
    expect(applyDecisionRules(decision({ confidence: 'medium' }), observation(true)).action).toBe('fill')
    // 低置信度的非执行动作不受影响
    expect(
      applyDecisionRules(decision({ action: 'skip', resumePath: '', confidence: 'low' }), observation(true)).action,
    ).toBe('skip')
  })
})

describe('refinePlan', () => {
  it('applies rules per decision and keeps unknown field decisions as-is', () => {
    const obs = [
      observation(false, { fieldId: 'f_1', label: '姓名' }),
      observation(false, { fieldId: 'f_2', label: '邮箱' }),
    ]
    const plan = [
      decision({ fieldId: 'f_1', action: 'keep' }), // 空字段 keep → fill
      decision({ fieldId: 'f_99', action: 'keep' }), // 未知字段：原样保留
    ]

    const refined = refinePlan(plan, obs)
    expect(refined[0].action).toBe('fill')
    expect(refined[1].action).toBe('keep')
  })
})
