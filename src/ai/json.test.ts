import { describe, expect, it } from 'vitest'

import { parseJsonFromAiText } from './json'

describe('parseJsonFromAiText', () => {
  it('accepts JSON with trailing commas', () => {
    const parsed = parseJsonFromAiText('{ "name": "陈嘉昊", "skills": ["React", "Node.js",], }') as Record<
      string,
      unknown
    >

    expect(parsed.name).toBe('陈嘉昊')
    expect(parsed.skills).toEqual(['React', 'Node.js'])
  })

  it('extracts JSON before prose that contains braces', () => {
    const parsed = parseJsonFromAiText(
      ['下面是整理后的 JSON：', '{ "name": "陈嘉昊", "city": "上海" }', '说明：字段 {additional.notes} 因原文缺失已留空。'].join('\n'),
    ) as Record<string, unknown>

    expect(parsed.name).toBe('陈嘉昊')
    expect(parsed.city).toBe('上海')
  })

  it('strips markdown code fences', () => {
    const parsed = parseJsonFromAiText('```json\n{ "ok": true }\n```') as Record<string, unknown>

    expect(parsed.ok).toBe(true)
  })

  it('throws on empty input', () => {
    expect(() => parseJsonFromAiText('')).toThrow(/AI 返回为空/)
    expect(() => parseJsonFromAiText(null)).toThrow(/AI 返回为空/)
  })

  it('repairs smart quotes in JSON strings', () => {
    const parsed = parseJsonFromAiText('{ "name": “陈嘉昊” }') as Record<string, unknown>

    expect(parsed.name).toBe('陈嘉昊')
  })

  it('extracts balanced JSON when prose has stray brackets', () => {
    const parsed = parseJsonFromAiText('结果如下 {"a": {"b": 1}} ] 结束') as Record<string, unknown>

    expect(parsed).toEqual({ a: { b: 1 } })
  })
})
