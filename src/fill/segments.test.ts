import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectFormSegments, findNextStepCandidates, waitForSegmentChange } from './segments'
import type { FieldDescriptor, FieldRuntime } from './types'

function mockEl(root: HTMLElement | null): HTMLElement {
  return {
    closest: (selector: string) => (root && selector.includes(root.tagName) ? root : null),
    isConnected: true,
  } as unknown as HTMLElement
}

function makeField(fieldId: string): FieldDescriptor {
  return {
    fieldId,
    kind: 'text',
    label: fieldId,
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
  }
}

describe('detectFormSegments', () => {
  it('groups fields sharing the same form ancestor', () => {
    const fields = [makeField('f_1'), makeField('f_2'), makeField('f_3')]
    const formRoot = { tagName: 'form' } as HTMLElement
    const fieldsetRoot = { tagName: 'fieldset' } as HTMLElement
    const runtimeMap = new Map<string, FieldRuntime>()
    runtimeMap.set('f_1', { fieldId: 'f_1', kind: 'text', el: mockEl(formRoot) })
    runtimeMap.set('f_2', { fieldId: 'f_2', kind: 'text', el: mockEl(formRoot) })
    runtimeMap.set('f_3', { fieldId: 'f_3', kind: 'text', el: mockEl(fieldsetRoot) })

    const segments = detectFormSegments(fields, runtimeMap)

    expect(segments).toHaveLength(2)
    expect(segments[0].fieldIds).toEqual(['f_1', 'f_2'])
    expect(segments[1].fieldIds).toEqual(['f_3'])
    expect(segments[0].rootEl).toBe(formRoot)
  })

  it('falls back to sequential chunks of 8 when no group ancestor', () => {
    const fields = Array.from({ length: 10 }, (_, index) => makeField(`f_${index}`))
    const runtimeMap = new Map<string, FieldRuntime>()
    for (const field of fields) {
      runtimeMap.set(field.fieldId, { fieldId: field.fieldId, kind: 'text', el: mockEl(null) })
    }

    const segments = detectFormSegments(fields, runtimeMap)

    expect(segments).toHaveLength(2)
    expect(segments[0].fieldIds).toHaveLength(8)
    expect(segments[1].fieldIds).toHaveLength(2)
    expect(segments.every((segment) => segment.rootEl === null)).toBe(true)
  })

  it('returns empty for empty fields', () => {
    expect(detectFormSegments([], new Map())).toEqual([])
  })
})

describe('findNextStepCandidates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('matches next-step text and excludes cancel/back', () => {
    const makeButton = (text: string) =>
      ({
        textContent: text,
        disabled: false,
        getClientRects: () => [{}],
      }) as unknown as HTMLElement

    const buttons = [makeButton('下一步'), makeButton('取消'), makeButton('上一步'), makeButton('保存并下一步')]
    const scope = {
      querySelectorAll: () => buttons,
    } as unknown as ParentNode

    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible', display: 'block' }))

    const candidates = findNextStepCandidates(scope)
    expect(candidates.map((item) => item.text)).toEqual(['下一步', '保存并下一步'])
  })

  it('returns empty when document is unavailable and no root given', () => {
    const original = globalThis.document
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true })
    expect(findNextStepCandidates()).toEqual([])
    Object.defineProperty(globalThis, 'document', { value: original, configurable: true })
  })
})

describe('waitForSegmentChange', () => {
  it('resolves false immediately for empty elements', async () => {
    expect(await waitForSegmentChange([], { timeoutMs: 10 })).toBe(false)
  })

  it('resolves false on timeout when elements stay connected', async () => {
    const el = { isConnected: true } as Element
    const result = await waitForSegmentChange([el], { timeoutMs: 30, pollMs: 10 })
    expect(result).toBe(false)
  })

  it('resolves true once an element is detached', async () => {
    const el = { isConnected: true } as Element
    setTimeout(() => {
      ;(el as { isConnected: boolean }).isConnected = false
    }, 15)

    const result = await waitForSegmentChange([el], { timeoutMs: 500, pollMs: 10 })
    expect(result).toBe(true)
  })
})
