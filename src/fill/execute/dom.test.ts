import { describe, expect, it, vi } from 'vitest'

import { setValueWithEvents } from './dom'

/** 假 input：记录派发的事件与属性写入，避免依赖真实 DOM */
function fakeInput() {
  const events: Array<{ type: string }> = []
  const el = {
    value: '',
    readOnly: false,
    hasAttribute: () => false,
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
    scrollIntoView: vi.fn(),
    dispatchEvent: (event: Event) => {
      events.push({ type: event.type })
      return true
    },
  }
  return { el: el as unknown as HTMLInputElement, events }
}

describe('setValueWithEvents composition events', () => {
  it('dispatches composition chain for Chinese values', async () => {
    const { el, events } = fakeInput()

    const ok = await setValueWithEvents(el, '张三', {
      fieldId: 'f',
      kind: 'text',
    })

    expect(ok).toBe(true)
    expect(el.value).toBe('张三')
    const types = events.map((event) => event.type)
    expect(types).toContain('compositionstart')
    expect(types).toContain('compositionend')
    expect(types.indexOf('compositionstart')).toBeLessThan(types.indexOf('compositionend'))
  })

  it('skips composition events for ASCII values', async () => {
    const { el, events } = fakeInput()

    await setValueWithEvents(el, 'zhang@example.com', { fieldId: 'f', kind: 'text' })

    expect(events.map((event) => event.type)).toEqual(['input', 'change'])
  })

  it('falls back to Event when CompositionEvent is unavailable', async () => {
    const original = (globalThis as { CompositionEvent?: unknown }).CompositionEvent
    const { el, events } = fakeInput()
    // Node 环境本就没有 CompositionEvent；显式确保 undefined 走降级路径
    ;(globalThis as { CompositionEvent?: unknown }).CompositionEvent = undefined

    try {
      await setValueWithEvents(el, '北京大学', { fieldId: 'f', kind: 'text' })
    } finally {
      ;(globalThis as { CompositionEvent?: unknown }).CompositionEvent = original
    }

    expect(events.map((event) => event.type)).toContain('compositionend')
  })
})
