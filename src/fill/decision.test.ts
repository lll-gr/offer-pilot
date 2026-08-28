import { describe, expect, it } from 'vitest'

import { buildDecisionPrompt, normalizeDecisionResponse } from './decision'

describe('buildDecisionPrompt', () => {
  it('serializes scene elements into JSON prompt', () => {
    const prompt = buildDecisionPrompt({
      segmentIndex: 1,
      segmentTotal: 3,
      lastSegmentLabels: ['姓名', '手机号码'],
      candidates: [{ text: '下一步' }, { text: '保存并下一步' }],
      newFieldLabels: ['教育经历'],
      anomaly: '字段数从 20 变为 5',
    })

    const parsed = JSON.parse(prompt)
    expect(parsed.segmentIndex).toBe(1)
    expect(parsed.segmentTotal).toBe(3)
    expect(parsed.lastSegmentLabels).toEqual(['姓名', '手机号码'])
    expect(parsed.candidates).toHaveLength(2)
    expect(parsed.anomaly).toBe('字段数从 20 变为 5')
  })

  it('clips long label lists and drops empty anomaly', () => {
    const prompt = buildDecisionPrompt({
      segmentIndex: 0,
      segmentTotal: 1,
      lastSegmentLabels: Array.from({ length: 40 }, (_, i) => `字段${i}`),
      candidates: [],
    })

    const parsed = JSON.parse(prompt)
    expect(parsed.lastSegmentLabels).toHaveLength(30)
    expect(parsed.anomaly).toBeUndefined()
  })
})

describe('normalizeDecisionResponse', () => {
  it('normalizes valid click decisions with in-range index', () => {
    const decision = normalizeDecisionResponse(
      { action: 'click', buttonIndex: 1, reason: '保存并下一步更明确' },
      2,
    )
    expect(decision).toEqual({ action: 'click', buttonIndex: 1, reason: '保存并下一步更明确' })
  })

  it('falls back to ask_human on out-of-range buttonIndex', () => {
    const decision = normalizeDecisionResponse({ action: 'click', buttonIndex: 5, reason: '' }, 2)
    expect(decision.action).toBe('ask_human')
    expect(decision.buttonIndex).toBe(-1)
  })

  it('falls back to ask_human on invalid input or unknown action', () => {
    expect(normalizeDecisionResponse(null, 2).action).toBe('ask_human')
    expect(normalizeDecisionResponse('garbage', 2).action).toBe('ask_human')
    expect(normalizeDecisionResponse({ action: 'destroy' }, 2).action).toBe('ask_human')
  })

  it('keeps wait/stop decisions without buttonIndex', () => {
    expect(normalizeDecisionResponse({ action: 'wait', reason: '页面加载中' }, 0)).toEqual({
      action: 'wait',
      buttonIndex: -1,
      reason: '页面加载中',
    })
    expect(normalizeDecisionResponse({ action: 'stop', reason: '已是最后一块' }, 0).action).toBe('stop')
    expect(normalizeDecisionResponse({ action: 'ask_human', reason: '' }, 0).action).toBe('ask_human')
  })

  it('truncates overly long reasons', () => {
    const decision = normalizeDecisionResponse({ action: 'wait', reason: '长'.repeat(500) }, 0)
    expect(decision.reason.length).toBe(200)
  })
})
