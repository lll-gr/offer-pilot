import { describe, expect, it } from 'vitest'

import { buildResumeImportPrompt, limitTextForPrompt, PROMPT_TEXT_LIMIT } from './prompts'

describe('resume import prompt', () => {
  it('embeds template, enum options and raw text', () => {
    const prompt = buildResumeImportPrompt('张三的简历')

    expect(prompt).toContain('固定 JSON 模板')
    expect(prompt).toContain('personal')
    expect(prompt).toContain('educations')
    expect(prompt).toContain('personal.gender: 男 | 女 | 非二元 | 不方便透露')
    expect(prompt).toContain('张三的简历')
  })

  it('limits oversized raw text', () => {
    const text = 'a'.repeat(PROMPT_TEXT_LIMIT + 100)

    expect(limitTextForPrompt(text).length).toBe(PROMPT_TEXT_LIMIT)
    expect(limitTextForPrompt('short')).toBe('short')
  })
})
