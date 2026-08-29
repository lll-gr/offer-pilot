import { describe, expect, it } from 'vitest'

import { isFillEvent } from './events'
import type { FillEvent } from './events'

describe('isFillEvent', () => {
  it('accepts every event type in the union', () => {
    const events: FillEvent[] = [
      { type: 'log', level: 'info', text: 'x' },
      { type: 'error', text: 'x' },
      { type: 'stats', fieldCount: 3, mappedCount: 2, filledCount: 1 },
      { type: 'phase', phase: 'executing' },
      { type: 'phase', phase: 'aiBatch', batch: 2, batches: 5 },
      {
        type: 'fieldProgress',
        fieldId: 'f_1',
        label: '姓名',
        status: 'filled',
        verified: true,
        processed: 1,
        total: 3,
      },
    ]

    for (const event of events) {
      expect(isFillEvent(event), `type=${event.type}`).toBe(true)
    }
  })

  it('rejects non-events and tab messages', () => {
    expect(isFillEvent({ type: 'updateStats' })).toBe(false) // 旧消息形状
    expect(isFillEvent({ type: 'unknown' })).toBe(false)
    expect(isFillEvent({ action: 'startFill' })).toBe(false)
    expect(isFillEvent({ action: 'ping' })).toBe(false)
    expect(isFillEvent(null)).toBe(false)
    expect(isFillEvent(undefined)).toBe(false)
    expect(isFillEvent('x')).toBe(false)
    expect(isFillEvent(42)).toBe(false)
  })
})
