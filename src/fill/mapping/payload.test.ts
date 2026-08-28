import { describe, expect, it } from 'vitest'

import { normalizeResumeProfile } from '@/resume/schema'

import { buildFieldMappingPayload, normalizeMappings, sanitizePageUrl } from './payload'

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

describe('buildFieldMappingPayload', () => {
  it('includes sanitized url, fields and only filled resume fields', () => {
    const profile = normalizeResumeProfile({
      personal: { fullName: '陈嘉昊', email: 'a@b.c' },
    })

    const payload = buildFieldMappingPayload(makeFields(), profile, {
      url: 'https://apply.example.com/form?token=secret#step2',
      title: '申请表',
    })

    expect(payload.url).toBe('https://apply.example.com/form')
    expect(payload.title).toBe('申请表')
    expect(payload.fields.length).toBe(2)
    expect(payload.resumeFields.some((f) => f.path === 'personal.fullName')).toBe(true)
    expect(payload.resumeFields.some((f) => f.path === 'personal.phone')).toBe(false)
    expect(payload.allowedTransforms.length).toBe(5)
  })
})

describe('normalizeMappings', () => {
  it('keeps valid mappings and drops invalid field ids or paths', () => {
    const mappings = normalizeMappings(
      [
        { fieldId: 'f_1', resumePath: 'personal.fullName', reason: '姓名', transform: { type: 'none' } },
        { fieldId: 'f_99', resumePath: 'personal.email', reason: '无效字段', transform: {} },
        { fieldId: 'f_2', resumePath: 'not.a.real.path', reason: '无效路径', transform: {} },
        { fieldId: 'f_2', resumePath: 'personal.gender', reason: '性别', transform: { type: 'date_part', part: 'month' } },
        'garbage',
      ],
      makeFields(),
    )

    expect(mappings.length).toBe(3)
    expect(mappings[0]).toEqual({
      fieldId: 'f_1',
      resumePath: 'personal.fullName',
      reason: '姓名',
      transform: { type: 'none' },
    })
    expect(mappings[1].fieldId).toBe('f_2')
    expect(mappings[1].resumePath).toBe('')
    expect(mappings[2].resumePath).toBe('personal.gender')
    expect(mappings[2].transform).toEqual({ type: 'date_part', part: 'month' })
  })

  it('tolerates non-array input', () => {
    expect(normalizeMappings(null, makeFields())).toEqual([])
    expect(normalizeMappings('x', makeFields())).toEqual([])
  })
})

describe('sanitizePageUrl', () => {
  it('strips query and hash', () => {
    expect(sanitizePageUrl('https://a.com/p?x=1#h')).toBe('https://a.com/p')
    expect(sanitizePageUrl('invalid')).toBe('invalid')
  })
})
