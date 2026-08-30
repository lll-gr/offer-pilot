import { describe, expect, it } from 'vitest'

import type { FilledFieldSnapshot } from '@/messaging/bridge'
import {
  applyBackfillToProfile,
  buildBackfillPayload,
  normalizeBackfillMappings,
  parseBackfillMappings,
} from './backfill'
import { createEmptyResumeProfile, getValueByPath, normalizeResumeProfile } from './schema'

function snapshot(
  fieldId: string,
  label: string,
  value: string,
  overrides: Partial<FilledFieldSnapshot> = {}
): FilledFieldSnapshot {
  return {
    fieldId,
    kind: 'text',
    label,
    placeholder: '',
    context: '',
    sectionLabel: '',
    nearbyLabels: [],
    options: [],
    value,
    ...overrides,
  }
}

describe('buildBackfillPayload', () => {
  it('includes page values, resume hasValue flags, and sanitized url', () => {
    const profile = normalizeResumeProfile({ personal: { fullName: '张三' } })
    const fields = [snapshot('f_1', '邮箱', 'a@b.c')]

    const payload = buildBackfillPayload(fields, profile, {
      url: 'https://example.com/apply?token=secret#top',
      title: '网申表单',
    })

    expect(payload.url).toBe('https://example.com/apply')
    expect(payload.pageFields[0].value).toBe('a@b.c')
    const fullName = payload.resumeFields.find((field) => field.path === 'personal.fullName')
    const email = payload.resumeFields.find((field) => field.path === 'personal.email')
    expect(fullName?.hasValue).toBe(true)
    expect(email?.hasValue).toBe(false)
  })

  it('caps long page values in the payload', () => {
    const fields = [snapshot('f_1', '自我评价', 'x'.repeat(500))]
    const payload = buildBackfillPayload(fields, createEmptyResumeProfile(), {
      url: 'https://example.com',
      title: '',
    })
    expect(payload.pageFields[0].value.length).toBe(300)
  })
})

describe('normalizeBackfillMappings', () => {
  const fields = [snapshot('f_1', '邮箱', 'a@b.c'), snapshot('f_2', '学校', '浙江大学')]

  it('keeps valid mappings and drops unknown fieldId or resumePath', () => {
    const mappings = normalizeBackfillMappings(
      {
        mappings: [
          { fieldId: 'f_1', resumePath: 'personal.email', reason: 'ok' },
          { fieldId: 'f_9', resumePath: 'personal.phone', reason: 'unknown field' },
          { fieldId: 'f_2', resumePath: 'not.a.path', reason: 'invalid path' },
        ],
      },
      fields
    )

    expect(mappings).toEqual([{ fieldId: 'f_1', resumePath: 'personal.email', reason: 'ok' }])
  })

  it('keeps only the first mapping per page field', () => {
    const mappings = normalizeBackfillMappings(
      {
        mappings: [
          { fieldId: 'f_1', resumePath: 'personal.email', reason: 'first' },
          { fieldId: 'f_1', resumePath: 'personal.alternateEmail', reason: 'second' },
        ],
      },
      fields
    )

    expect(mappings).toHaveLength(1)
    expect(mappings[0].resumePath).toBe('personal.email')
  })

  it('parses AI text with markdown fences', () => {
    const mappings = parseBackfillMappings(
      '```json\n{ "mappings": [{ "fieldId": "f_2", "resumePath": "educations.0.school" }] }\n```',
      fields
    )
    expect(mappings).toEqual([
      { fieldId: 'f_2', resumePath: 'educations.0.school', reason: '' },
    ])
  })
})

describe('applyBackfillToProfile', () => {
  it('writes page values into empty resume fields only', () => {
    const profile = normalizeResumeProfile({ personal: { fullName: '张三' } })
    const fields = [snapshot('f_1', '邮箱', 'a@b.c'), snapshot('f_2', '姓名', '李四')]
    const mappings = [
      { fieldId: 'f_1', resumePath: 'personal.email', reason: '' },
      { fieldId: 'f_2', resumePath: 'personal.fullName', reason: '' },
    ]

    const { profile: next, result } = applyBackfillToProfile(profile, fields, mappings)

    expect(getValueByPath(next, 'personal.email')).toBe('a@b.c')
    expect(getValueByPath(next, 'personal.fullName')).toBe('张三') // 已有值不覆盖
    expect(result.updates).toHaveLength(1)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({
      resumePath: 'personal.fullName',
      pageValue: '李四',
      resumeValue: '张三',
    })
    // 原 profile 不被修改
    expect(getValueByPath(profile, 'personal.email')).toBe('')
  })

  it('treats format-equivalent existing values as no-ops, not conflicts', () => {
    const profile = normalizeResumeProfile({
      personal: { phoneNumber: '138-1234-5678' },
      educations: [{ startDate: '2020.09' }],
    })
    const fields = [
      snapshot('f_1', '手机号', '13812345678'),
      snapshot('f_2', '入学时间', '2020-09'),
    ]
    const mappings = [
      { fieldId: 'f_1', resumePath: 'personal.phoneNumber', reason: '' },
      { fieldId: 'f_2', resumePath: 'educations.0.startDate', reason: '' },
    ]

    const { result } = applyBackfillToProfile(profile, fields, mappings)

    expect(result.updates).toHaveLength(0)
    expect(result.conflicts).toHaveLength(0)
    expect(result.ignored).toBe(2)
  })

  it('ignores junk values and derived fields', () => {
    const profile = createEmptyResumeProfile()
    const fields = [
      snapshot('f_1', '政治面貌', '无'),
      snapshot('f_2', '年龄', '24'),
    ]
    const mappings = [
      { fieldId: 'f_1', resumePath: 'identityAndAuthorization.politicalStatus', reason: '' },
      { fieldId: 'f_2', resumePath: 'personal.age', reason: '' },
    ]

    const { result } = applyBackfillToProfile(profile, fields, mappings)

    expect(result.updates).toHaveLength(0)
    expect(result.conflicts).toHaveLength(0)
  })

  it('grows list sections when mapping to a higher slot', () => {
    const profile = createEmptyResumeProfile() // educations 只有 1 个槽位
    const fields = [snapshot('f_1', '学校名称', '浙江大学')]
    const mappings = [{ fieldId: 'f_1', resumePath: 'educations.1.school', reason: '' }]

    const { profile: next } = applyBackfillToProfile(profile, fields, mappings)

    expect(getValueByPath(next, 'educations.1.school')).toBe('浙江大学')
    // 归一化后列表按有意义条目收敛
    const normalized = normalizeResumeProfile(next)
    expect((normalized.educations as unknown[]).length).toBe(2)
  })

  it('keeps the first mapping when multiple page fields target one resume field', () => {
    const profile = createEmptyResumeProfile()
    const fields = [snapshot('f_1', '手机', '13812345678'), snapshot('f_2', '联系方式', '13900139000')]
    const mappings = [
      { fieldId: 'f_1', resumePath: 'personal.phoneNumber', reason: '' },
      { fieldId: 'f_2', resumePath: 'personal.phoneNumber', reason: '' },
    ]

    const { profile: next, result } = applyBackfillToProfile(profile, fields, mappings)

    expect(getValueByPath(next, 'personal.phoneNumber')).toBe('13812345678')
    expect(result.updates).toHaveLength(1)
    expect(result.ignored).toBe(1)
  })
})
