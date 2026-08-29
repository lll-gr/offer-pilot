import { describe, expect, it } from 'vitest'

import { normalizeResumeProfile } from '@/resume/schema'

import type { FieldDescriptor, FieldObservation } from '../types'
import { buildFieldPlanningPayload, normalizeDecisions, sanitizePageUrl } from './payload'

function makeFields() {
  return [
    {
      fieldId: 'f_1',
      kind: 'text' as const,
      label: '姓名',
      name: 'name',
      id: '',
      placeholder: '',
      options: [],
      required: true,
      context: '基本信息',
      sectionKey: 'personal',
      sectionLabel: '基本信息',
      sectionEvidence: '',
      nearbyLabels: [],
    },
    {
      fieldId: 'f_2',
      kind: 'select' as const,
      label: '性别',
      name: 'gender',
      id: '',
      placeholder: '',
      options: ['男', '女'],
      required: false,
      context: '基本信息',
      sectionKey: 'personal',
      sectionLabel: '基本信息',
      sectionEvidence: '',
      nearbyLabels: [],
    },
  ]
}

function makeObservations(currentValues: Record<string, string> = {}): FieldObservation[] {
  return makeFields().map((descriptor: FieldDescriptor) => {
    const currentValue = currentValues[descriptor.fieldId] || ''
    return {
      descriptor,
      runtime: undefined,
      currentValue,
      hasValue: Boolean(currentValue),
    }
  })
}

describe('buildFieldPlanningPayload', () => {
  it('includes sanitized url, current values and only filled resume fields', () => {
    const profile = normalizeResumeProfile({
      personal: { fullName: '陈嘉昊', email: 'a@b.c' },
    })

    const payload = buildFieldPlanningPayload(
      makeObservations({ f_1: '陈嘉昊', f_2: '' }),
      profile,
      {
        url: 'https://apply.example.com/form?token=secret#step2',
        title: '申请表',
      },
    )

    expect(payload.url).toBe('https://apply.example.com/form')
    expect(payload.title).toBe('申请表')
    expect(payload.fields.length).toBe(2)
    expect(payload.fields[0].currentValuePreview).toBe('陈嘉昊')
    expect(payload.fields[0].hasValue).toBe(true)
    expect(payload.fields[1].currentValuePreview).toBe('')
    expect(payload.fields[1].hasValue).toBe(false)
    expect(payload.allowedActions).toEqual(['fill', 'keep', 'correct', 'manual', 'skip'])
    expect(payload.resumeFields.some((f) => f.path === 'personal.fullName')).toBe(true)
    expect(payload.resumeFields.some((f) => f.path === 'personal.phone')).toBe(false)
    expect(payload.allowedTransforms.length).toBe(5)
  })
})

describe('normalizeDecisions', () => {
  it('keeps valid decisions with actions and drops invalid field ids or paths', () => {
    const decisions = normalizeDecisions(
      [
        { fieldId: 'f_1', action: 'fill', resumePath: 'personal.fullName', reason: '姓名', transform: { type: 'none' } },
        { fieldId: 'f_99', action: 'fill', resumePath: 'personal.email', reason: '无效字段', transform: {} },
        { fieldId: 'f_2', action: 'keep', resumePath: 'not.a.real.path', reason: '无效路径', transform: {} },
        { fieldId: 'f_2', action: 'correct', resumePath: 'personal.gender', reason: '性别', transform: { type: 'date_part', part: 'month' } },
        'garbage',
      ],
      makeObservations({ f_2: '男' }),
    )

    expect(decisions.length).toBe(3)
    expect(decisions[0]).toEqual({
      fieldId: 'f_1',
      action: 'fill',
      confidence: 'medium',
      resumePath: 'personal.fullName',
      reason: '姓名',
      transform: { type: 'none' },
    })
    expect(decisions[1].fieldId).toBe('f_2')
    expect(decisions[1].action).toBe('keep')
    expect(decisions[1].resumePath).toBe('')
    expect(decisions[2].resumePath).toBe('personal.gender')
    expect(decisions[2].action).toBe('correct')
    expect(decisions[2].transform).toEqual({ type: 'date_part', part: 'month' })
  })

  it('falls back action to fill/skip when AI omits or returns invalid action', () => {
    const decisions = normalizeDecisions(
      [
        { fieldId: 'f_1', resumePath: 'personal.fullName', reason: '无动作' },
        { fieldId: 'f_2', resumePath: '', reason: '无映射无动作' },
        { fieldId: 'f_1', action: 'nonsense', resumePath: 'personal.fullName', reason: '非法动作' },
      ],
      makeObservations(),
    )

    expect(decisions[0].action).toBe('fill')
    expect(decisions[1].action).toBe('skip')
    expect(decisions[2].action).toBe('fill')
  })

  it('validates confidence and defaults to medium', () => {
    const decisions = normalizeDecisions(
      [
        { fieldId: 'f_1', action: 'fill', confidence: 'high', resumePath: 'personal.fullName' },
        { fieldId: 'f_2', action: 'fill', confidence: 'guess', resumePath: 'personal.gender' },
      ],
      makeObservations(),
    )

    expect(decisions[0].confidence).toBe('high')
    expect(decisions[1].confidence).toBe('medium')
  })

  it('tolerates non-array input', () => {
    expect(normalizeDecisions(null, makeObservations())).toEqual([])
    expect(normalizeDecisions('x', makeObservations())).toEqual([])
  })
})

describe('sanitizePageUrl', () => {
  it('strips query and hash', () => {
    expect(sanitizePageUrl('https://a.com/p?x=1#h')).toBe('https://a.com/p')
    expect(sanitizePageUrl('invalid')).toBe('invalid')
  })
})
