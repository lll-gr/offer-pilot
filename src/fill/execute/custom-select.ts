/**
 * 自定义下拉组件（Ant Design / Element Plus / Arco 等非原生 select）：
 * 选项 DOM 在点击后才渲染（常挂 body 下的 portal），扫描期不可见。
 * 三级回退：点开找选项点击 → 可输入时「输入搜索 + Enter」→ 读回验证。
 * DOM 依赖以 CustomSelectDom 接口注入，默认实现走真实 document，测试可替换。
 */

import type { FieldRuntime, FillResult } from '../types'
import { clickLikeUser } from './dom'
import { getMatchScore, pickBestOption } from './match'
import { FillVerificationError } from './verify'

export const CUSTOM_SELECT_OPTION_SELECTORS = [
  '[role="option"]',
  '.ant-select-item-option',
  '.el-select-dropdown__item',
  '.arco-select-option',
  'li[role="option"]',
  '.dropdown-item',
]

export interface CustomSelectOption {
  label: string
  value: string
  el: HTMLElement
}

export interface CustomSelectDom {
  openDropdown(el: HTMLElement): Promise<void>
  findOptions(): CustomSelectOption[]
  clickOption(el: HTMLElement): Promise<void>
  pressEnter(el: HTMLElement): void
  pressEscape(el: HTMLElement): void
  typeText(el: HTMLElement, text: string): void
  sleep(ms: number): Promise<void>
}

function isVisibleLike(el: Element | null | undefined): boolean {
  if (!el) return false
  try {
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    const rects = el.getClientRects()
    return Boolean(rects && rects.length > 0)
  } catch {
    return false
  }
}

function isDisabledOption(el: Element): boolean {
  if (el.getAttribute('aria-disabled') === 'true') return true
  return /disabled/i.test(String(el.getAttribute('class') || ''))
}

function findVisibleOptions(): CustomSelectOption[] {
  const selector = CUSTOM_SELECT_OPTION_SELECTORS.join(',')
  const elements = typeof document !== 'undefined' ? Array.from(document.querySelectorAll(selector)) : []
  return elements
    .filter((el) => isVisibleLike(el) && !isDisabledOption(el))
    .map((el) => {
      const label = String(el.textContent || '').trim().slice(0, 80)
      return { label, value: label, el: el as HTMLElement }
    })
    .filter((option) => option.label)
}

function pressKey(el: HTMLElement, key: 'Enter' | 'Escape'): void {
  const Ctor = typeof KeyboardEvent === 'function' ? KeyboardEvent : Event
  const init = { key, bubbles: true, cancelable: true } as KeyboardEventInit
  el.dispatchEvent(new Ctor('keydown', init))
  el.dispatchEvent(new Ctor('keypress', init))
  el.dispatchEvent(new Ctor('keyup', init))
}

function isTypeable(el: HTMLElement | null | undefined): boolean {
  const tag = el?.tagName?.toLowerCase?.() || ''
  return tag === 'input' || tag === 'textarea'
}

function setInputValue(el: HTMLElement, text: string): void {
  const tag = el.tagName?.toLowerCase?.() || ''
  const proto = tag === 'textarea' ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
  if (tag === 'input' || tag === 'textarea') {
    setter ? setter.call(el, text) : ((el as HTMLInputElement).value = text)
    return
  }
  ;(el as HTMLInputElement).value = text
}

/** 浏览器真实 DOM 实现（content script 环境） */
export const BROWSER_CUSTOM_SELECT_DOM: CustomSelectDom = {
  async openDropdown(el) {
    clickLikeUser(el)
  },
  findOptions() {
    return findVisibleOptions()
  },
  async clickOption(el) {
    clickLikeUser(el)
  },
  pressEnter(el) {
    pressKey(el, 'Enter')
  },
  pressEscape(el) {
    pressKey(el, 'Escape')
  },
  typeText(el, text) {
    el.focus?.()
    setInputValue(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  },
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  },
}

const PLACEHOLDER_LIKE = /^请(选择|输入|拾取|选择或搜索)/

/** 读回当前显示值：input 取 value，其余取 textContent；占位文本视为空 */
export function readCustomSelectDisplay(el: HTMLElement | null | undefined): string {
  if (!el) return ''
  const text = isTypeable(el)
    ? String((el as HTMLInputElement).value ?? '').trim()
    : String(el.textContent || '').trim()
  if (!text) return ''
  if (PLACEHOLDER_LIKE.test(text)) return ''
  if (typeof el.getAttribute === 'function' && text === (el.getAttribute('placeholder') || '').trim()) {
    return ''
  }
  return text
}

/** 轮询等待下拉选项渲染（portal 挂载有延迟；轮数封顶避免热循环） */
async function waitForOptions(dom: CustomSelectDom, timeoutMs = 1200): Promise<CustomSelectOption[]> {
  const startedAt = Date.now()
  let options = dom.findOptions()
  let polls = 0

  while (options.length === 0 && Date.now() - startedAt < timeoutMs && polls < 50) {
    await dom.sleep(120)
    polls += 1
    options = dom.findOptions()
  }
  return options
}

function displayMatches(displayed: string, desired: string): boolean {
  if (!displayed || !desired) return false
  return getMatchScore(displayed, desired) >= 60
}

/** 填充自定义下拉：三级回退，最终读回不一致时抛 FillVerificationError 交由 withRetry 重试 */
export async function fillCustomSelect(
  runtime: FieldRuntime,
  value: string | string[],
  logger?: (message: string) => void,
  dom: CustomSelectDom = BROWSER_CUSTOM_SELECT_DOM
): Promise<FillResult> {
  const el = runtime.el as HTMLElement | undefined
  if (!el) return { filled: false, message: '字段不存在' }

  const desired = Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).join(', ')
    : String(value ?? '').trim()
  if (!desired) return { filled: false, message: '没有可填写内容' }

  let settled = false
  try {
    // 层级一：点开下拉 → 找最佳匹配选项点击
    await dom.openDropdown(el)
    const options = await waitForOptions(dom)
    const best = options.length > 0 ? pickBestOption(options, desired) : null

    if (best) {
      await dom.clickOption(best.el)
      await dom.sleep(200)
      const displayed = readCustomSelectDisplay(el)
      if (displayMatches(displayed, desired)) {
        settled = true
        return { filled: true, verified: true }
      }
      logger?.(`自定义下拉点击「${best.label}」后读回为「${displayed || '空'}」，尝试回退方案`)
    }

    // 层级二：可输入组件（搜索式下拉）→ 输入 + Enter
    if (isTypeable(el)) {
      dom.typeText(el, desired)
      await dom.sleep(400)
      dom.pressEnter(el)
      await dom.sleep(200)
      const displayed = readCustomSelectDisplay(el)
      if (displayMatches(displayed, desired)) {
        settled = true
        return { filled: true, verified: true }
      }
    }

    const displayed = readCustomSelectDisplay(el)
    const noOptionsNote = options.length === 0 ? '（未出现下拉选项）' : ''
    throw new FillVerificationError({
      ok: false,
      expected: desired,
      actual: `${displayed || '未选中'}${noOptionsNote}`,
    })
  } finally {
    if (!settled) {
      // 失败路径兜底收起下拉（多选/搜索态可能未自动关闭；成功路径组件会自关）
      try {
        dom.pressEscape(el)
      } catch {
        // Ignore.
      }
    }
  }
}
