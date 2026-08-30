import { describe, expect, it } from 'vitest'

import { normalizeResumeProfile } from '@/resume/schema'
import type { FieldDescriptor, FieldObservation } from './types'
import { runPlanExecute } from './plan-execute'
import { MAPPING_CACHE_KEY } from '@/messaging/bridge'

function descriptor(fieldId: string, label: string, overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    fieldId,
    kind: 'text',
    label,
    name: '',
    id: '',
    placeholder: '',
    autocomplete: '',
    options: [],
    required: false,
    context: '',
    sectionKey: '',
    sectionLabel: '',
    sectionEvidence: '',
    nearbyLabels: [],
    ...overrides,
  }
}

function observation(fieldId: string, label: string, overrides: Partial<FieldDescriptor> = {}): FieldObservation {
  return {
    descriptor: descriptor(fieldId, label, overrides),
    runtime: undefined,
    currentValue: '',
    hasValue: false,
  }
}

const PROFILE = normalizeResumeProfile({
  personal: { fullName: '张三', email: 'zhang@example.com' },
  contactAndLocation: { hometownCity: '南京' },
})

function fakeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial }
  return {
    storage: {
      get: async (keys: string[]) => {
        const out: Record<string, unknown> = {}
        for (const key of keys) out[key] = store[key]
        return out
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items)
      },
    },
    store,
  }
}

/** AI 假实现：记录调用次序与载荷，返回对 AI 字段的 fill 决策 */
function fakeCallAi(order: string[], prompts: string[]) {
  return async (_modelId: string, prompt: string) => {
    order.push('ai')
    prompts.push(prompt)
    return JSON.stringify({
      decisions: [{ fieldId: 'f_2', action: 'fill', confidence: 'high', resumePath: 'contactAndLocation.hometownCity', reason: '籍贯字段', transform: { type: 'none' } }],
    })
  }
}

const LOC = { origin: 'https://example.com', pathname: '/apply', host: 'example.com' }

const BASE_DEPS = {
  fillMode: 'overwrite' as const,
  sendLog: () => {},
  payloadMeta: { url: 'https://example.com/apply', title: '网申' },
  locationMeta: LOC,
}

describe('runPlanExecute', () => {
  it('fills rule-hit fields first, then AI-planned fields (ordering)', async () => {
    const order: string[] = []
    const prompts: string[] = []
    const { storage } = fakeStorage()

    const result = await runPlanExecute(
      [observation('f_1', '姓名'), observation('f_2', '籍贯')],
      PROFILE,
      'model-1',
      {
        ...BASE_DEPS,
        storage,
        callAi: fakeCallAi(order, prompts),
        onFieldProgress: (event) => {
          if (event.fieldId === 'f_1') order.push(`progress:f_1:${event.status}`)
        },
      }
    )

    // AI 载荷只含剩余字段（f_2），规则命中的 f_1 不进 AI
    expect(prompts).toHaveLength(1)
    const payload = JSON.parse(prompts[0])
    expect(payload.fields.map((field: { fieldId: string }) => field.fieldId)).toEqual(['f_2'])

    // f_1 的字段进度事件先于 AI 调用
    const firstAiIndex = order.indexOf('ai')
    expect(order.slice(0, firstAiIndex)).toContain('progress:f_1:pending')

    // 决策与统计
    expect(result.ruleDecidedCount).toBe(1)
    expect(result.plan.map((decision) => decision.resumePath)).toEqual(
      expect.arrayContaining(['personal.fullName', 'contactAndLocation.hometownCity']),
    )
    // outcomes 顺序：规则字段在前
    expect(result.outcomes[0].fieldId).toBe('f_1')
  })

  it('persists merged rule+AI decisions into the cache', async () => {
    const { storage, store } = fakeStorage()

    await runPlanExecute([observation('f_1', '姓名'), observation('f_2', '籍贯')], PROFILE, 'model-1', {
      ...BASE_DEPS,
      storage,
      callAi: fakeCallAi([], []),
    })

    const cache = store[MAPPING_CACHE_KEY] as Record<string, { decisions: Array<{ resumePath: string; fieldKey?: string }> }>
    const entries = Object.values(cache)
    expect(entries).toHaveLength(1)
    const paths = entries[0].decisions.map((decision) => decision.resumePath).sort()
    expect(paths).toEqual(['contactAndLocation.hometownCity', 'personal.fullName'])
    // 落盘条目带字段指纹（下次重放对齐用）
    expect(entries[0].decisions.every((decision) => Boolean(decision.fieldKey))).toBe(true)
  })

  it('replays from cache on the second run without calling AI', async () => {
    const { storage } = fakeStorage()
    const aiCalls: string[] = []

    await runPlanExecute([observation('f_1', '姓名'), observation('f_2', '籍贯')], PROFILE, 'model-1', {
      ...BASE_DEPS,
      storage,
      callAi: fakeCallAi(aiCalls, []),
    })

    const secondResult = await runPlanExecute(
      [observation('f_1', '姓名'), observation('f_2', '籍贯')],
      PROFILE,
      'model-1',
      {
        ...BASE_DEPS,
        storage,
        callAi: fakeCallAi(aiCalls, []),
      }
    )

    expect(aiCalls).toHaveLength(1) // 第二次未调 AI
    expect(secondResult.cacheHit).toBe(true)
    expect(secondResult.plan.map((decision) => decision.resumePath)).toEqual(
      expect.arrayContaining(['personal.fullName', 'contactAndLocation.hometownCity']),
    )
  })

  it('keeps rule-pass fills observable even when AI planning throws', async () => {
    const events: string[] = []

    await expect(
      runPlanExecute([observation('f_1', '姓名'), observation('f_2', '籍贯')], PROFILE, 'model-1', {
        ...BASE_DEPS,
        storage: fakeStorage().storage,
        callAi: async () => {
          events.push('ai')
          throw new Error('模型超时')
        },
        onFieldProgress: (event) => {
          if (event.fieldId === 'f_1') events.push(`f_1:${event.status}`)
        },
      })
    ).rejects.toThrow('模型超时')

    // AI 失败前，规则字段已执行（pass1 的进度事件已发出——DOM 写入已发生，部分成功保留）
    expect(events[0]).toBe('f_1:pending')
    expect(events.indexOf('f_1:pending')).toBeLessThan(events.indexOf('ai'))
  })

  it('skips AI planning entirely when the signal is aborted between passes', async () => {
    const controller = new AbortController()
    controller.abort()
    const aiCalls: string[] = []

    const result = await runPlanExecute(
      [observation('f_1', '姓名'), observation('f_2', '籍贯')],
      PROFILE,
      'model-1',
      {
        ...BASE_DEPS,
        signal: controller.signal,
        storage: fakeStorage().storage,
        callAi: fakeCallAi(aiCalls, []),
      }
    )

    expect(aiCalls).toHaveLength(0)
    expect(result.plan.map((decision) => decision.fieldId)).toEqual(['f_1'])
  })

  it('reports progress against the full field count across both passes', async () => {
    const { storage } = fakeStorage()
    const events: Array<{ fieldId: string; processed: number; total: number }> = []

    await runPlanExecute([observation('f_1', '姓名'), observation('f_2', '籍贯')], PROFILE, 'model-1', {
      ...BASE_DEPS,
      storage,
      callAi: fakeCallAi([], []),
      onFieldProgress: (event) => {
        events.push({ fieldId: event.fieldId, processed: event.processed, total: event.total })
      },
    })

    expect(events.every((event) => event.total === 2)).toBe(true)
    // pass2 从 pass1 已处理数续接：f_2 的 pending 显示此前已完成 1 个，落定后为 2
    const f2Events = events.filter((event) => event.fieldId === 'f_2')
    expect(f2Events[0].processed).toBe(1)
    expect(events[events.length - 1].processed).toBe(2)
  })
})
