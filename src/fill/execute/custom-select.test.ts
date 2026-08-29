import { describe, expect, it, vi } from 'vitest'

import {
  CUSTOM_SELECT_OPTION_SELECTORS,
  fillCustomSelect,
  readCustomSelectDisplay,
} from './custom-select'
import type { CustomSelectDom, CustomSelectOption } from './custom-select'
import { FillVerificationError } from './verify'
import type { FieldRuntime } from '../types'

function inputCombobox(value = ''): HTMLInputElement {
  return {
    tagName: 'INPUT',
    value,
    getAttribute: () => '',
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as HTMLInputElement
}

function divCombobox(text = ''): HTMLElement {
  return {
    tagName: 'DIV',
    textContent: text,
    getAttribute: () => '',
    focus: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as HTMLElement
}

function runtime(el: HTMLElement): FieldRuntime {
  return { fieldId: 'f', kind: 'custom_select', el }
}

interface FakeDomSetup {
  options?: CustomSelectOption[]
  /** 点击选项后的读回值（模拟组件选中态渲染，写回元素本体） */
  displayAfterClick?: string
  /** Enter 后的读回值（模拟搜索选中，写回元素本体） */
  displayAfterEnter?: string
}

function fakeDom(setup: FakeDomSetup) {
  const typed: string[] = []
  let target: HTMLElement | undefined

  const applyDisplay = (el: HTMLElement | undefined, text?: string) => {
    if (!el || text == null) return
    if ('value' in el) {
      ;(el as HTMLInputElement).value = text
    } else {
      el.textContent = text
    }
  }

  const dom: CustomSelectDom = {
    async openDropdown(el) {
      target = el
    },
    findOptions: () => setup.options || [],
    async clickOption() {
      applyDisplay(target, setup.displayAfterClick)
    },
    pressEnter() {
      applyDisplay(target, setup.displayAfterEnter)
    },
    pressEscape: vi.fn(),
    typeText(_el, text) {
      typed.push(text)
    },
    sleep: async () => {},
  }
  return { dom, typed }
}

describe('readCustomSelectDisplay', () => {
  it('reads input value and treats placeholder as empty', () => {
    expect(readCustomSelectDisplay(inputCombobox('硕士'))).toBe('硕士')
    expect(readCustomSelectDisplay(inputCombobox('请选择'))).toBe('')
    expect(readCustomSelectDisplay(divCombobox('请选择或搜索'))).toBe('')
  })

  it('reads textContent for div-based combobox', () => {
    expect(readCustomSelectDisplay(divCombobox('北京'))).toBe('北京')
  })

  it('returns empty for missing element', () => {
    expect(readCustomSelectDisplay(undefined)).toBe('')
  })
})

describe('fillCustomSelect', () => {
  const optionEls = CUSTOM_SELECT_OPTION_SELECTORS.map((selector) =>
    ({ textContent: selector, dispatchEvent: vi.fn() } as unknown as HTMLElement),
  )

  function options(labels: string[]): CustomSelectOption[] {
    return labels.map((label, index) => ({ label, value: label, el: optionEls[index] || ({} as HTMLElement) }))
  }

  it('tier 1: opens dropdown, clicks best matching option, verifies read-back', async () => {
    const el = inputCombobox('请选择')
    const { dom, typed } = fakeDom({
      options: options(['大专', '大学本科', '硕士研究生']),
      displayAfterClick: '硕士研究生',
    })

    const result = await fillCustomSelect(runtime(el), '硕士', undefined, dom)

    expect(result).toEqual({ filled: true, verified: true })
    expect(typed).toEqual([]) // 未走输入回退
  })

  it('tier 1: alias equivalence matches desired value', async () => {
    const el = inputCombobox('')
    const { dom } = fakeDom({
      options: options(['高中', '大专', '大学本科']),
      displayAfterClick: '大学本科',
    })

    const result = await fillCustomSelect(runtime(el), '本科', undefined, dom)
    expect(result.filled).toBe(true)
  })

  it('tier 2: falls back to type-and-enter when option click does not land', async () => {
    const el = inputCombobox('请选择')
    const { dom, typed } = fakeDom({
      options: options(['大专', '本科', '硕士']),
      displayAfterClick: '请选择', // 点击没生效
      displayAfterEnter: '硕士',
    })

    const result = await fillCustomSelect(runtime(el), '硕士', undefined, dom)

    expect(result).toEqual({ filled: true, verified: true })
    expect(typed).toEqual(['硕士'])
  })

  it('tier 2: works when dropdown renders no options (search-only component)', async () => {
    const el = inputCombobox('')
    const { dom, typed } = fakeDom({
      options: [],
      displayAfterEnter: '北京',
    })

    const result = await fillCustomSelect(runtime(el), '北京', undefined, dom)

    expect(result).toEqual({ filled: true, verified: true })
    expect(typed).toEqual(['北京'])
  })

  it('throws FillVerificationError with expected vs actual when nothing lands', async () => {
    const el = inputCombobox('请选择')
    const { dom } = fakeDom({
      options: options(['大专', '本科']),
      displayAfterClick: '请选择',
      displayAfterEnter: '请选择',
    })

    await expect(fillCustomSelect(runtime(el), '硕士', undefined, dom)).rejects.toThrow(
      FillVerificationError,
    )
    await expect(fillCustomSelect(runtime(el), '硕士', undefined, dom)).rejects.toThrow(
      '期望「硕士」',
    )
  })

  it('does not attempt typing for div-based combobox (not typeable)', async () => {
    const el = divCombobox('请选择')
    const { dom, typed } = fakeDom({
      options: options(['大专', '本科']),
      displayAfterClick: '本科',
    })

    const result = await fillCustomSelect(runtime(el), '本科', undefined, dom)
    expect(result.filled).toBe(true)
    expect(typed).toEqual([])
  })

  it('returns early for missing element or empty value', async () => {
    const { dom } = fakeDom({})
    expect((await fillCustomSelect({ fieldId: 'f', kind: 'custom_select' }, 'x', undefined, dom)).message).toContain(
      '字段不存在',
    )
    expect((await fillCustomSelect(runtime(inputCombobox()), '', undefined, dom)).message).toContain(
      '没有可填写内容',
    )
  })
})
