import { describe, expect, it } from 'vitest'

import { getSystemPrompt, SYSTEM_PROMPTS } from './prompts'

describe('system prompts', () => {
  it('field mapping prompt includes campus recruiting constraints', () => {
    const prompt = SYSTEM_PROMPTS.field_mapping

    expect(prompt).toMatch(/校招场景优先级/)
    expect(prompt).toMatch(/internships\.\*/)
    expect(prompt).toMatch(/campusExperiences\.\*/)
    expect(prompt).toMatch(/educations\.\*/)
    expect(prompt).toMatch(/没有实习经历/)
    expect(prompt).toMatch(/hasValue=true/)
    expect(prompt).toMatch(/sectionLabel/)
    expect(prompt).toMatch(/nearbyLabels/)
  })

  it('resume import prompt demands JSON-only output', () => {
    expect(SYSTEM_PROMPTS.resume_import).toMatch(/只输出 JSON/)
    expect(SYSTEM_PROMPTS.resume_import).toMatch(/不要新增字段/)
  })

  it('rejects unknown modes', () => {
    expect(() => getSystemPrompt('unknown')).toThrow(/不支持的 AI 模式/)
  })
})
