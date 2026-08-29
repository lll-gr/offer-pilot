import { describe, expect, it } from 'vitest'

import { normalizeResumeProfile } from '@/resume/schema'
import type { FieldDescriptor, FieldObservation } from '../types'
import { planByRules } from './rule-planner'

function descriptor(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    fieldId: 'f_1',
    kind: 'text',
    label: '',
    name: '',
    id: '',
    placeholder: '',
    autocomplete: '',
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

function observation(
  descriptorOverrides: Partial<FieldDescriptor> = {},
  hasValue = false
): FieldObservation {
  return {
    descriptor: descriptor(descriptorOverrides),
    runtime: undefined,
    currentValue: hasValue ? 'x' : '',
    hasValue,
  }
}

const PROFILE = normalizeResumeProfile({
  personal: { fullName: '张三', firstName: '三', lastName: '张', email: 'zhang@example.com', phoneNumber: '13800138000' },
})

describe('planByRules', () => {
  it('maps standard autocomplete tokens deterministically', () => {
    const { decisions, remaining } = planByRules(
      [
        observation({ fieldId: 'f_1', autocomplete: 'email' }),
        observation({ fieldId: 'f_2', autocomplete: 'given-name' }),
        observation({ fieldId: 'f_3', autocomplete: 'tel-national' }),
      ],
      PROFILE,
    )

    expect(decisions).toHaveLength(3)
    expect(remaining).toHaveLength(0)
    expect(decisions[0]).toMatchObject({ fieldId: 'f_1', resumePath: 'personal.email', action: 'fill', confidence: 'high' })
    expect(decisions[1].resumePath).toBe('personal.firstName')
    expect(decisions[2].resumePath).toBe('personal.phoneNumber')
  })

  it('falls back to name/id exact tokens when autocomplete missing', () => {
    const { decisions } = planByRules(
      [
        observation({ fieldId: 'f_1', name: 'email' }),
        observation({ fieldId: 'f_2', id: 'first_name' }),
      ],
      PROFILE,
    )

    expect(decisions[0].resumePath).toBe('personal.email')
    expect(decisions[1].resumePath).toBe('personal.firstName')
  })

  it('marks action as correct when field already has a value', () => {
    const { decisions } = planByRules([observation({ autocomplete: 'email' }, true)], PROFILE)
    expect(decisions[0].action).toBe('correct')
  })

  it('returns unmatched or valueless fields to the AI ring', () => {
    const { decisions, remaining } = planByRules(
      [
        observation({ fieldId: 'f_1', label: '任意字段' }), // 无命中
        observation({ fieldId: 'f_2', autocomplete: 'email' }), // 档案无值？——有值，看下一个
        observation({ fieldId: 'f_3', autocomplete: 'bday' }), // 档案无生日
        observation({ fieldId: 'f_4', kind: 'radio_group', autocomplete: 'email' }), // 类型不符
      ],
      PROFILE,
    )

    // f_2 规则命中且有值；f_1/f_3/f_4 回落 AI 环
    expect(decisions.map((item) => item.fieldId)).toEqual(['f_2'])
    expect(remaining.map((item) => item.descriptor.fieldId)).toEqual(['f_1', 'f_3', 'f_4'])
  })

  it('normalizes token case and separators', () => {
    const { decisions } = planByRules(
      [observation({ fieldId: 'f_1', autocomplete: 'EMAIL' }), observation({ fieldId: 'f_2', id: 'FIRST-NAME' })],
      PROFILE,
    )
    expect(decisions).toHaveLength(2)
  })

  it('ignores unknown autocomplete tokens', () => {
    const { decisions, remaining } = planByRules(
      [observation({ autocomplete: 'off' }), observation({ autocomplete: 'new-password' })],
      PROFILE,
    )
    expect(decisions).toHaveLength(0)
    expect(remaining).toHaveLength(2)
  })
})
