import { describe, expect, it } from 'vitest'

import { getSystemPrompt, SYSTEM_PROMPTS } from './prompts'

describe('system prompts', () => {
  it('form planning prompt includes five actions and decision rules', () => {
    const prompt = SYSTEM_PROMPTS.form_planning

    expect(prompt).toMatch(/校招场景优先级/)
    expect(prompt).toMatch(/internships\.\*/)
    expect(prompt).toMatch(/campusExperiences\.\*/)
    expect(prompt).toMatch(/educations\.\*/)
    expect(prompt).toMatch(/没有实习经历/)
    expect(prompt).toMatch(/hasValue=true/)
    expect(prompt).toMatch(/sectionLabel/)
    expect(prompt).toMatch(/nearbyLabels/)

    // 五动作决策层
    expect(prompt).toMatch(/"action": "fill"/)
    for (const action of ['fill', 'keep', 'correct', 'manual', 'skip']) {
      expect(prompt).toMatch(new RegExp(`${action}：`))
    }
    // 置信度分级：low 不允许直接 fill
    expect(prompt).toMatch(/"confidence": "high"/)
    expect(prompt).toMatch(/confidence/)
    expect(prompt).toMatch(/low：线索不足/)
    // 等价容忍与身份字段逐字规则
    expect(prompt).toMatch(/等价容忍/)
    expect(prompt).toMatch(/逐字一致/)
    // 输入含 currentValuePreview，输出键为 decisions
    expect(prompt).toMatch(/currentValuePreview/)
    expect(prompt).toMatch(/"decisions"/)
    // 反幻觉约束
    expect(prompt).toMatch(/不要编造任何值/)
    // 派生字段与自定义下拉说明
    expect(prompt).toMatch(/personal\.age/)
    expect(prompt).toMatch(/custom_select/)
  })

  it('resume import prompt demands JSON-only output', () => {
    expect(SYSTEM_PROMPTS.resume_import).toMatch(/只输出 JSON/)
    expect(SYSTEM_PROMPTS.resume_import).toMatch(/不要新增字段/)
    expect(SYSTEM_PROMPTS.resume_import).toMatch(/严禁输出示例值或占位值/)
  })

  it('rejects unknown modes', () => {
    expect(() => getSystemPrompt('unknown')).toThrow(/不支持的 AI 模式/)
  })
})
