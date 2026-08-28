import { describe, expect, it } from 'vitest'

import { isDeepScanExpandTrigger } from './deep-scan'

interface MockElementOptions {
  text?: string
  attrs?: Record<string, string | null>
  className?: string
  tagName?: string
  ownerGetElementById?: (id: string) => Element | null
}

function mockElement({ text, attrs = {}, className = '', tagName = 'BUTTON', ownerGetElementById }: MockElementOptions): Element {
  const element = {
    tagName,
    textContent: text,
    className,
    disabled: false,
    dataset: {},
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null
    },
    ownerDocument: {
      getElementById: ownerGetElementById ?? (() => null),
    },
  }

  return element as unknown as Element
}

describe('isDeepScanExpandTrigger', () => {
  it('does not click add or new-item controls', () => {
    expect(isDeepScanExpandTrigger(mockElement({ text: '添加教育经历' }))).toBe(false)
    expect(isDeepScanExpandTrigger(mockElement({ text: '新增项目经历', className: 'expand' }))).toBe(false)
    expect(isDeepScanExpandTrigger(mockElement({ text: '+', className: 'plus-button' }))).toBe(false)
  })

  it('accepts explicit collapsed expand controls', () => {
    expect(
      isDeepScanExpandTrigger(mockElement({ text: '展开教育经历', attrs: { 'aria-expanded': 'false' } })),
    ).toBe(true)
    expect(
      isDeepScanExpandTrigger(mockElement({ text: '查看更多', attrs: { 'aria-expanded': 'false' } })),
    ).toBe(true)
  })

  it('rejects popup triggers and already-expanded controls', () => {
    expect(
      isDeepScanExpandTrigger(mockElement({ text: '展开菜单', attrs: { 'aria-haspopup': 'menu' } })),
    ).toBe(false)
    expect(
      isDeepScanExpandTrigger(mockElement({ text: '展开教育经历', attrs: { 'aria-expanded': 'true' } })),
    ).toBe(false)
    expect(isDeepScanExpandTrigger(mockElement({ text: '提交表单', attrs: { type: 'submit' } }))).toBe(false)
  })

  it('recognizes hidden targets referenced by data-target', () => {
    const hiddenTarget = {
      hidden: true,
      getAttribute: () => null,
    } as unknown as Element

    const element = mockElement({
      text: '更多',
      attrs: { 'data-target': '#details' },
      ownerGetElementById: (id) => (id === 'details' ? hiddenTarget : null),
    })

    expect(isDeepScanExpandTrigger(element)).toBe(true)
  })

  it('requires button/a/role=button tags', () => {
    expect(isDeepScanExpandTrigger(mockElement({ text: '展开全部', tagName: 'DIV' }))).toBe(false)
  })
})
