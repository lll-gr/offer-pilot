import { describe, expect, it } from 'vitest'

import {
  INITIAL_FIELD_PROGRESS,
  reduceFieldProgress,
} from './FillProgressPanel'
import type { FieldProgressEvent } from '@/messaging/events'

function progress(overrides: Partial<FieldProgressEvent>): FieldProgressEvent {
  return {
    type: 'fieldProgress',
    fieldId: 'f_1',
    label: '姓名',
    status: 'filled',
    processed: 1,
    total: 3,
    ...overrides,
  }
}

describe('reduceFieldProgress', () => {
  it('phase events drive the lifecycle view', () => {
    let state = reduceFieldProgress(INITIAL_FIELD_PROGRESS, { type: 'phase', phase: 'scanning' })
    expect(state.phase).toBe('scanning')

    state = reduceFieldProgress(state, { type: 'phase', phase: 'aiBatch', batch: 2, batches: 5 })
    expect(state.phase).toBe('aiBatch')
    expect(state.batch).toEqual({ current: 2, total: 5 })

    state = reduceFieldProgress(state, { type: 'phase', phase: 'executing' })
    expect(state.phase).toBe('executing')
    expect(state.batch).toBeNull()
  })

  it('pending sets current field without counting', () => {
    const next = reduceFieldProgress(
      INITIAL_FIELD_PROGRESS,
      progress({ status: 'pending', fieldId: 'f_1', processed: 0 })
    )

    expect(next.current).toEqual({ fieldId: 'f_1', label: '姓名' })
    expect(next.processed).toBe(0)
    expect(next.filled).toBe(0)
    expect(next.total).toBe(3)
  })

  it('terminal statuses increment counts and push recent', () => {
    let state = reduceFieldProgress(INITIAL_FIELD_PROGRESS, progress({ status: 'pending' }))
    state = reduceFieldProgress(state, progress({ status: 'filled', fieldId: 'f_1', processed: 1 }))
    state = reduceFieldProgress(state, progress({ status: 'manual', fieldId: 'f_2', label: '身份证', processed: 2 }))
    state = reduceFieldProgress(state, progress({ status: 'skipped', fieldId: 'f_3', label: '备注', processed: 3 }))

    expect(state.processed).toBe(3)
    expect(state.filled).toBe(1)
    expect(state.manual).toBe(1)
    expect(state.skipped).toBe(1)
    expect(state.recent.map((item) => item.fieldId)).toEqual(['f_3', 'f_2', 'f_1'])
  })

  it('caps recent list at 8 and replaces pending with terminal for same field', () => {
    let state = INITIAL_FIELD_PROGRESS
    for (let i = 1; i <= 10; i += 1) {
      state = reduceFieldProgress(
        state,
        progress({ fieldId: `f_${i}`, label: `字段${i}`, status: 'filled', processed: i })
      )
    }

    expect(state.recent).toHaveLength(8)
    expect(state.recent[0].fieldId).toBe('f_10')
    expect(state.filled).toBe(10)
  })

  it('same field events are deduplicated in recent (latest wins)', () => {
    let state = reduceFieldProgress(INITIAL_FIELD_PROGRESS, progress({ status: 'filled', fieldId: 'f_1' }))
    state = reduceFieldProgress(state, progress({ status: 'failed', fieldId: 'f_1' }))

    expect(state.recent).toHaveLength(1)
    expect(state.recent[0].status).toBe('failed')
    expect(state.filled).toBe(1)
    expect(state.failed).toBe(1)
  })
})
