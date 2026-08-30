import { describe, expect, it } from 'vitest'

import {
  computeAgeFromBirthDate,
  computeIsFreshGraduate,
  createEmptyResumeProfile,
  formatSectionSummary,
  getCatalogWithValues,
  getFieldCatalog,
  getListSectionMaxItems,
  getSectionDefinition,
  getSectionStats,
  getValueByPath,
  hasAnyFilledField,
  normalizeDateValue,
  normalizeResumeProfile,
  setValueByPath,
} from './schema'

describe('resume schema', () => {
  it('creates an empty profile with one initial item per list section', () => {
    const profile = createEmptyResumeProfile()

    expect(getSectionDefinition('educations')?.type).toBe('list')
    expect(Array.isArray(profile.educations)).toBe(true)
    expect((profile.educations as unknown[]).length).toBe(1)
    expect(getValueByPath(profile, 'personal.fullName')).toBe('')
  })

  it('max-mode profile fills all list slots (for AI import template)', () => {
    const profile = createEmptyResumeProfile({ mode: 'max' })

    expect((profile.educations as unknown[]).length).toBe(getListSectionMaxItems('educations'))
    expect((profile.workExperiences as unknown[]).length).toBe(getListSectionMaxItems('workExperiences'))
  })

  it('normalizes dates in various formats', () => {
    expect(normalizeDateValue('2020年3月5日')).toBe('2020-03-05')
    expect(normalizeDateValue('2020.03')).toBe('2020-03')
    expect(normalizeDateValue('20200305')).toBe('2020-03-05')
    expect(normalizeDateValue('2020-3')).toBe('2020-03')
    expect(normalizeDateValue('至今')).toBe('至今')
  })

  it('normalizes AI import payload with aliases and date ranges', () => {
    const profile = normalizeResumeProfile({
      personal: { fullName: '陈嘉昊', birthday: '2001-06-15' },
      educations: [{ school: '浙江大学', dateRange: '2020.09 - 2024.06', 学历: '本科' }],
    })

    expect(getValueByPath(profile, 'personal.birthDate')).toBe('2001-06-15')
    expect(getValueByPath(profile, 'educations.0.school')).toBe('浙江大学')
    expect(getValueByPath(profile, 'educations.0.startDate')).toBe('2020-09')
    expect(getValueByPath(profile, 'educations.0.endDate')).toBe('2024-06')
    expect(getValueByPath(profile, 'educations.0.degree')).toBe('本科')
  })

  it('derives birth date from personal id when missing', () => {
    const profile = normalizeResumeProfile({
      identityAndAuthorization: { personalIdNumber: '110101200106150011' },
    })

    expect(getValueByPath(profile, 'personal.birthDate')).toBe('2001-06-15')
    expect(getValueByPath(profile, 'identityAndAuthorization.personalIdType')).toBe('身份证')
  })

  it('derives age and fresh-graduate status on normalize', () => {
    const profile = normalizeResumeProfile({
      personal: { fullName: '陈嘉昊', birthDate: '2001-06-15' },
      educations: [{ school: '浙江大学', dateRange: '2020.09 - 2024.06' }],
    })

    expect(getValueByPath(profile, 'personal.isFreshGraduate')).toMatch(/^(是|否)$/)
    // 年龄为纯数字字符串（精确值随当前时间变化，形状断言避免测试腐烂）
    expect(getValueByPath(profile, 'personal.age')).toMatch(/^\d{1,3}$/)
  })

  it('maps select values through alias groups', () => {
    const profile = normalizeResumeProfile({
      personal: { gender: 'male' },
      jobPreferences: { employmentType: 'internship' },
    })

    expect(getValueByPath(profile, 'personal.gender')).toBe('男')
    expect(getValueByPath(profile, 'jobPreferences.employmentType')).toBe('实习')
  })

  it('drops removed legacy skill keys on normalize', () => {
    const profile = normalizeResumeProfile({
      skills: { programmingLanguages: 'JavaScript', softSkills: '沟通', interests: '羽毛球' },
    })

    const skills = getValueByPath(profile, 'skills') as Record<string, string>
    expect(skills.professionalSkills).toBe('')
    expect(skills.softSkills).toBe('沟通')
    expect(skills.interests).toBe('羽毛球')
  })

  it('setValueByPath creates intermediate containers', () => {
    const target: Record<string, unknown> = {}

    setValueByPath(target, 'educations.2.school', '清华')

    const educations = target.educations as unknown[]
    expect(educations.length).toBe(3)
    expect(getValueByPath(target, 'educations.2.school')).toBe('清华')
  })

  describe('derived fill-time values (pure functions with injected now)', () => {
    // 固定“当前时间”：2026-08-29
    const NOW = new Date(2026, 7, 29)

    it('computes full-year age with birthday-not-yet-reached adjustment', () => {
      expect(computeAgeFromBirthDate('2001-03-15', NOW)).toBe('25')
      expect(computeAgeFromBirthDate('2001-08-29', NOW)).toBe('25') // 生日当天
      expect(computeAgeFromBirthDate('2001-08-30', NOW)).toBe('24') // 生日未到
      expect(computeAgeFromBirthDate('2001-09', NOW)).toBe('24') // 月精度
      expect(computeAgeFromBirthDate('2001', NOW)).toBe('25') // 年精度按 1 月 1 日
    })

    it('rejects invalid or out-of-range birth dates', () => {
      expect(computeAgeFromBirthDate('', NOW)).toBe('')
      expect(computeAgeFromBirthDate('not-a-date', NOW)).toBe('')
      expect(computeAgeFromBirthDate('1899-01-01', NOW)).toBe('') // 超界
      expect(computeAgeFromBirthDate('2030-01-01', NOW)).toBe('') // 未来
    })

    it('judges fresh-graduate within 24 months of latest graduation', () => {
      expect(computeIsFreshGraduate(['2026-06'], NOW)).toBe('是')
      expect(computeIsFreshGraduate(['2024-09'], NOW)).toBe('是') // 24 个月内
      expect(computeIsFreshGraduate(['2024-06'], NOW)).toBe('否') // 超过 24 个月
      expect(computeIsFreshGraduate(['2027-06'], NOW)).toBe('是') // 在读未毕业
      expect(computeIsFreshGraduate([], NOW)).toBe('')
      expect(computeIsFreshGraduate([''], NOW)).toBe('')
    })

    it('uses the latest graduation date across multiple educations', () => {
      expect(computeIsFreshGraduate(['2020-06', '2026-06'], NOW)).toBe('是')
      expect(computeIsFreshGraduate(['2026-06', '2020-06'], NOW)).toBe('是')
      expect(computeIsFreshGraduate(['2015-06', '2020-06'], NOW)).toBe('否')
    })
  })

  it('section stats and summaries reflect filled values', () => {
    const profile = normalizeResumeProfile({
      personal: { fullName: '陈嘉昊', email: 'a@b.c' },
      educations: [{ school: '浙江大学' }],
    })

    const stats = getSectionStats(profile)
    expect(stats.get('personal')?.filledFields).toBeGreaterThan(0)
    expect(stats.get('educations')?.filledItems).toBe(1)

    const educationSection = getSectionDefinition('educations')!
    expect(formatSectionSummary(educationSection, stats.get('educations')!)).toMatch(/已填写 1 条/)
    expect(hasAnyFilledField(profile)).toBe(true)
    expect(hasAnyFilledField(createEmptyResumeProfile())).toBe(false)
  })

  it('catalog paths cover group and list fields', () => {
    const catalog = getFieldCatalog({ mode: 'max' })
    const paths = catalog.map((field) => field.path)

    expect(paths).toContain('personal.fullName')
    expect(paths).toContain('educations.3.school')
    expect(getCatalogWithValues(createEmptyResumeProfile()).every((f) => !f.hasValue)).toBe(true)
  })
})
