import { beforeEach, describe, expect, it, vi } from 'vitest'

import { decideAdvance } from './advance-deciders'
import type { AdvanceContext } from './advance-deciders'
import type { NextStepCandidate } from './segments'

function candidate(text: string, semantic: 'advance' | 'submit'): NextStepCandidate {
  return { text, semantic, el: {} as Element }
}

function deps(overrides: Partial<AdvanceContext> = {}): AdvanceContext {
  return {
    ctx: {
      segmentIndex: 0,
      segmentTotal: 1,
      lastSegmentLabels: ['姓名'],
      candidates: [],
    },
    candidates: [],
    modelId: 'test-model',
    sendLog: vi.fn(),
    ...overrides,
  }
}

// mock ai/client（决策链内唯一外呼）与 dom 点击（Node 无 MouseEvent）
vi.mock('@/ai/client', () => ({
  callAI: vi.fn(),
}))
vi.mock('./execute/dom', () => ({
  clickLikeUser: vi.fn(),
}))

import { callAI } from '@/ai/client'
import { clickLikeUser } from './execute/dom'
const callAIMock = vi.mocked(callAI)
const clickMock = vi.mocked(clickLikeUser)

beforeEach(() => {
  callAIMock.mockReset()
  clickMock.mockReset()
})

describe('advance decision chain', () => {
  it('rule ring clicks the sole advance candidate without AI', async () => {
    const candidates = [candidate('下一步', 'advance'), candidate('提交', 'submit')]

    const verdict = await decideAdvance({ ...deps(), candidates })

    expect(verdict.kind).toBe('clicked')
    if (verdict.kind === 'clicked') {
      expect(verdict.via).toBe('rule')
      expect(verdict.button).toBe('下一步')
    }
    expect(clickMock).toHaveBeenCalledTimes(1)
    expect(clickMock).toHaveBeenCalledWith(candidates[0].el)
    expect(callAIMock).not.toHaveBeenCalled()
  })

  it('rule ring declines when multiple advance candidates exist, AI ring answers stop', async () => {
    callAIMock.mockResolvedValueOnce('{"action":"stop","reason":"已是最后一块"}')

    const verdict = await decideAdvance({
      ...deps(),
      candidates: [candidate('下一步', 'advance'), candidate('继续', 'advance')],
    })

    expect(callAIMock).toHaveBeenCalledTimes(1)
    expect(verdict).toEqual({ kind: 'stop', reason: '已是最后一块' })
  })

  it('AI wait verdict passes through', async () => {
    callAIMock.mockResolvedValueOnce('{"action":"wait","reason":"页面加载中"}')

    const verdict = await decideAdvance({
      ...deps(),
      candidates: [candidate('下一步', 'advance'), candidate('继续', 'advance')],
    })

    expect(verdict).toEqual({ kind: 'wait', reason: '页面加载中' })
  })

  it('AI click suggestion converts to ask_human (never auto-clicks; buttonIndex fix)', async () => {
    // 歧义场景（两个 advance）→ 规则环放行 → AI 建议点击 #1
    // AI 按全列表计数；决策链不再用该索引代点，转为人工提示
    callAIMock.mockResolvedValueOnce('{"action":"click","buttonIndex":1,"reason":"表单已完整"}')

    const candidates = [candidate('下一步', 'advance'), candidate('继续', 'advance')]
    const verdict = await decideAdvance({
      ...deps(),
      candidates,
      ctx: {
        segmentIndex: 0,
        segmentTotal: 1,
        lastSegmentLabels: ['姓名'],
        candidates: candidates.map((item) => ({ text: item.text })),
      },
    })

    expect(verdict.kind).toBe('ask_human')
    if (verdict.kind === 'ask_human') {
      expect(verdict.reason).toContain('#1')
    }
    expect(clickMock).not.toHaveBeenCalled()
  })

  it('AI failure falls through to human fallback', async () => {
    callAIMock.mockRejectedValueOnce(new Error('网络错误'))

    const verdict = await decideAdvance({
      ...deps(),
      candidates: [candidate('下一步', 'advance'), candidate('继续', 'advance')],
    })

    expect(verdict.kind).toBe('ask_human')
  })

  it('rule ring declines when no candidates, AI ask_human falls to human fallback', async () => {
    callAIMock.mockResolvedValueOnce('{"action":"ask_human","reason":"情况不明"}')

    const verdict = await decideAdvance({ ...deps(), candidates: [] })

    expect(verdict.kind).toBe('ask_human')
  })

  it('user abort propagates as AbortError from AI ring', async () => {
    const abort = new AbortController()
    abort.abort()
    const abortError = new DOMException('Aborted', 'AbortError')
    callAIMock.mockRejectedValueOnce(abortError)

    await expect(
      decideAdvance({
        ...deps(),
        candidates: [candidate('下一步', 'advance'), candidate('继续', 'advance')],
        signal: abort.signal,
      }),
    ).rejects.toBe(abortError)
  })
})
