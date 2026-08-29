import { describe, expect, it } from 'vitest'

import { executePlan } from './pipeline'
import type { FieldDecision, FieldDescriptor, FieldObservation, FieldRuntime } from '../types'

function descriptor(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    fieldId: 'f_1',
    kind: 'text',
    label: '姓名',
    name: '',
    id: '',
    placeholder: '',
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

function observation(
  descriptorOverrides: Partial<FieldDescriptor> = {},
  runtime?: FieldRuntime
): FieldObservation {
  const desc = descriptor(descriptorOverrides)
  return {
    descriptor: desc,
    runtime,
    currentValue: runtime ? 'x' : '',
    hasValue: Boolean(runtime),
  }
}

function decision(overrides: Partial<FieldDecision> = {}): FieldDecision {
  return {
    fieldId: 'f_1',
    action: 'fill',
    resumePath: 'personal.fullName',
    reason: 'AI 判定',
    transform: { type: 'none' },
    ...overrides,
  }
}

/** 模拟 select 元素：value 赋值联动 selectedIndex */
function fakeSelectEl(labels: string[]): HTMLSelectElement {
  const options = labels.map((label, index) => ({ textContent: label, value: String(index) }))
  const el = {
    options,
    selectedIndex: 0,
    dispatchEvent: () => true,
  } as unknown as Record<string, unknown> & HTMLSelectElement
  Object.defineProperty(el, 'value', {
    get: () => String(options[(el as { selectedIndex: number }).selectedIndex]?.value ?? ''),
    set: (next: string) => {
      const index = options.findIndex((option) => option.value === next)
      ;(el as { selectedIndex: number }).selectedIndex = index
    },
  })
  return el as unknown as HTMLSelectElement
}

const RESUME = {
  personal: { fullName: '张三', email: 'zhang@example.com' },
}

const NOOP_LOG = () => {}

describe('executePlan decision consumption', () => {
  it('skips fields without decisions and fields with skip action', async () => {
    const observations = [
      observation({ fieldId: 'f_1', label: '姓名' }),
      observation({ fieldId: 'f_2', label: '备注' }),
    ]
    const decisions = new Map<string, FieldDecision>([
      ['f_2', decision({ fieldId: 'f_2', action: 'skip', resumePath: '', reason: '与简历无关' })],
    ])

    const logs: string[] = []
    const outcome = await executePlan(observations, decisions, RESUME, {
      fillMode: 'overwrite',
      sendLog: (level, text) => logs.push(`${level}:${text}`),
    })

    expect(outcome.filledCount).toBe(0)
    expect(outcome.outcomes.map((item) => item.outcome)).toEqual(['skipped', 'skipped'])
    expect(logs.some((line) => line.includes('未返回该字段的决策'))).toBe(true)
    expect(logs.some((line) => line.includes('AI 判定跳过'))).toBe(true)
  })

  it('records manual and kept outcomes without executing', async () => {
    const observations = [
      observation({ fieldId: 'f_1', label: '身份证号码' }),
      observation({ fieldId: 'f_2', label: '姓名' }),
    ]
    const decisions = new Map<string, FieldDecision>([
      ['f_1', decision({ fieldId: 'f_1', action: 'manual', reason: '敏感字段' })],
      ['f_2', decision({ fieldId: 'f_2', action: 'keep', reason: '当前值已正确' })],
    ])

    const outcome = await executePlan(observations, decisions, RESUME, {
      fillMode: 'overwrite',
      sendLog: NOOP_LOG,
    })

    expect(outcome.outcomes.map((item) => item.outcome)).toEqual(['manual', 'kept'])
    expect(outcome.filledCount).toBe(0)
  })

  it('fills select field and marks verified via read-back', async () => {
    const el = fakeSelectEl(['请选择', '男', '女'])
    const observations = [
      observation({ fieldId: 'f_1', label: '性别', kind: 'select' }, { fieldId: 'f_1', kind: 'select', el }),
    ]
    const decisions = new Map<string, FieldDecision>([
      ['f_1', decision({ fieldId: 'f_1', resumePath: 'personal.gender' })],
    ])

    const outcome = await executePlan(observations, decisions, { personal: { gender: '男' } }, {
      fillMode: 'overwrite',
      sendLog: NOOP_LOG,
    })

    expect(outcome.filledCount).toBe(1)
    expect(el.selectedIndex).toBe(1)
    expect(outcome.outcomes[0]).toMatchObject({ outcome: 'filled', verified: true })
  })

  it('records failed outcome with message when strategy cannot fill', async () => {
    const observations = [
      observation({ fieldId: 'f_1', label: '附件', kind: 'file' }, { fieldId: 'f_1', kind: 'file' }),
    ]
    const decisions = new Map<string, FieldDecision>([
      ['f_1', decision({ fieldId: 'f_1', resumePath: 'personal.fullName' })],
    ])

    const outcome = await executePlan(observations, decisions, RESUME, {
      fillMode: 'overwrite',
      sendLog: NOOP_LOG,
    })

    expect(outcome.filledCount).toBe(0)
    expect(outcome.outcomes[0].outcome).toBe('failed')
    expect(outcome.outcomes[0].message).toContain('文件上传')
  })

  it('skips fields with empty resume value after transform', async () => {
    const observations = [observation({ fieldId: 'f_1', label: '姓名' })]
    const decisions = new Map<string, FieldDecision>([['f_1', decision({ fieldId: 'f_1' })]])

    const outcome = await executePlan(observations, decisions, { personal: {} }, {
      fillMode: 'overwrite',
      sendLog: NOOP_LOG,
    })

    expect(outcome.outcomes[0].outcome).toBe('skipped')
  })

  it('respects incremental mode for fill but not for correct', async () => {
    const elFilled = fakeSelectEl(['请选择', '男', '女'])
    elFilled.selectedIndex = 2 // 已有值：女
    const elCorrect = fakeSelectEl(['请选择', '男', '女'])
    elCorrect.selectedIndex = 2 // 已有值：女（错误值，应被修正）

    const observations = [
      observation({ fieldId: 'f_1', label: '性别1', kind: 'select' }, { fieldId: 'f_1', kind: 'select', el: elFilled }),
      observation({ fieldId: 'f_2', label: '性别2', kind: 'select' }, { fieldId: 'f_2', kind: 'select', el: elCorrect }),
    ]
    const decisions = new Map<string, FieldDecision>([
      ['f_1', decision({ fieldId: 'f_1', action: 'fill', resumePath: 'personal.gender' })],
      ['f_2', decision({ fieldId: 'f_2', action: 'correct', resumePath: 'personal.gender' })],
    ])

    const outcome = await executePlan(observations, decisions, { personal: { gender: '男' } }, {
      fillMode: 'incremental',
      sendLog: NOOP_LOG,
    })

    // fill：增量模式不覆盖；correct：现有值错误仍修正
    expect(outcome.outcomes[0].outcome).toBe('skipped')
    expect(elFilled.selectedIndex).toBe(2)
    expect(outcome.outcomes[1].outcome).toBe('filled')
    expect(elCorrect.selectedIndex).toBe(1)
  })

  it('stops at aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()

    const observations = [observation({ fieldId: 'f_1' })]
    const decisions = new Map<string, FieldDecision>([['f_1', decision({ fieldId: 'f_1' })]])

    const logs: string[] = []
    const outcome = await executePlan(observations, decisions, RESUME, {
      fillMode: 'overwrite',
      sendLog: (level, text) => logs.push(`${level}:${text}`),
      signal: controller.signal,
    })

    expect(outcome.outcomes).toHaveLength(0)
    expect(logs.some((line) => line.includes('停止指令'))).toBe(true)
  })
})
