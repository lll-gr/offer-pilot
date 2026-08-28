import { describe, expect, it } from 'vitest'

import { inferSectionFromTexts, normalizeSemanticText } from './semantics'

describe('section semantics', () => {
  it('normalizes text by stripping separators and case', () => {
    expect(normalizeSemanticText('  实习经历 (Intern) ')).toBe('实习经历intern')
  })

  it('infers education section from school/major keywords', () => {
    const result = inferSectionFromTexts(['教育经历', '学校名称', '专业'])

    expect(result.key).toBe('education')
    expect(result.label).toBe('教育经历')
    expect(result.score).toBeGreaterThan(0)
  })

  it('prefers internship over work for 实习 keywords', () => {
    const result = inferSectionFromTexts(['实习经历', '实习公司', '职位名称'])

    expect(result.key).toBe('internship')
  })

  it('detects campus experiences', () => {
    const result = inferSectionFromTexts(['学生组织', '社团'])

    expect(result.key).toBe('campus')
  })

  it('returns empty when evidence is weak', () => {
    const result = inferSectionFromTexts(['随便一个标签'])

    expect(result.key).toBe('')
    expect(result.score).toBe(0)
  })
})
