import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelHighlightAutoClear,
  clearFieldHighlights,
  scheduleHighlightAutoClear,
  showFieldHighlights,
} from './highlight'

interface MockElement extends Element {
  __classes: Set<string>
  __attrs: Map<string, string>
}

function mockElement(): MockElement {
  const classes = new Set<string>()
  const attrs = new Map<string, string>()
  const el = {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    removeAttribute: (name: string) => attrs.delete(name),
    getAttribute: (name: string) => attrs.get(name) ?? null,
    __classes: classes,
    __attrs: attrs,
  } as unknown as MockElement
  return el
}

function stubDocument(elements: Element[]): ReturnType<typeof vi.fn> {
  const queryAll = vi.fn().mockReturnValue(elements)
  vi.stubGlobal('document', { querySelectorAll: queryAll })
  return queryAll
}

describe('showFieldHighlights', () => {
  it('marks plain elements and group options', () => {
    const el = mockElement()
    const optionEl = mockElement()

    showFieldHighlights([
      { fieldId: 'f_1', kind: 'text', el: el as unknown as HTMLElement },
      {
        fieldId: 'f_2',
        kind: 'radio_group',
        options: [{ el: optionEl as unknown as HTMLInputElement, label: '男', value: 'male' }],
      },
    ])

    expect(el.getAttribute('data-offer-pilot-highlight')).toBe('1')
    expect(el.__classes.has('offer-pilot-filled')).toBe(true)
    expect(optionEl.getAttribute('data-offer-pilot-highlight')).toBe('1')
  })

  it('tolerates empty and missing elements', () => {
    expect(() => showFieldHighlights([])).not.toThrow()
    expect(() => showFieldHighlights([{ fieldId: 'f', kind: 'text', el: undefined }])).not.toThrow()
  })
})

describe('clearFieldHighlights', () => {
  it('removes markers via document query', () => {
    const el = mockElement()
    showFieldHighlights([{ fieldId: 'f', kind: 'text', el: el as unknown as HTMLElement }])

    const queryAll = stubDocument([el])
    clearFieldHighlights()

    expect(queryAll).toHaveBeenCalledWith('[data-offer-pilot-highlight]')
    expect(el.getAttribute('data-offer-pilot-highlight')).toBeNull()
    expect(el.__classes.has('offer-pilot-filled')).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('scheduleHighlightAutoClear', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cancelHighlightAutoClear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('auto clears after timeout', () => {
    const queryAll = stubDocument([])
    scheduleHighlightAutoClear(1000)

    expect(queryAll).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(queryAll).toHaveBeenCalled()
  })

  it('resets the timer on repeated calls', () => {
    const queryAll = stubDocument([])
    scheduleHighlightAutoClear(1000)
    vi.advanceTimersByTime(600)
    scheduleHighlightAutoClear(1000)
    vi.advanceTimersByTime(600)

    expect(queryAll).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(queryAll).toHaveBeenCalled()
  })
})
