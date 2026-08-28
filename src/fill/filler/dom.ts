/**
 * DOM 写入：原生 setter + input/change 事件、只读字段临时解锁、
 * select 按文本选中、radio/checkbox 点击、日期面板交互。
 */

import type { FieldRuntime, FillResult } from '../types'
import { matchesWrittenValue, normalizeValueForRuntime } from './runtime'
import { pickBestOption } from './match'
import { hasMeaningfulFillValue, normalizeCheckboxCandidates, prepareTextValueForRuntime } from './values'
import { matchesAnyCandidate } from './match'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function scrollIntoView(el: Element | null | undefined): void {
  if (!el) return

  try {
    // 填充流程逐字段滚动，instant 避免平滑动画串行叠加拖慢整体速度。
    el.scrollIntoView({ block: 'center', behavior: 'instant' })
  } catch {
    // Ignore.
  }
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const tag = element.tagName?.toLowerCase?.() || ''

  if (tag === 'input') {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter ? setter.call(element, value) : (element.value = value)
    return
  }

  if (tag === 'textarea') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter ? setter.call(element, value) : (element.value = value)
    return
  }

  element.value = value
}

export async function setValueWithEvents(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  runtime?: FieldRuntime
): Promise<boolean> {
  if (!el) return false

  scrollIntoView(el)
  const restoreReadonly =
    runtime?.readOnly || el.readOnly
      ? {
          property: Boolean(el.readOnly),
          attribute: el.hasAttribute('readonly'),
        }
      : null

  try {
    el.focus?.()
    if (restoreReadonly) {
      el.readOnly = false
      el.removeAttribute('readonly')
    }
    setNativeValue(el, value)
    el.setAttribute('value', value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.blur?.()
    await sleep(30)
    return matchesWrittenValue(runtime, el.value, value)
  } catch {
    return false
  } finally {
    if (restoreReadonly) {
      el.readOnly = restoreReadonly.property
      if (restoreReadonly.attribute) {
        el.setAttribute('readonly', '')
      } else {
        el.removeAttribute('readonly')
      }
    }
  }
}

export function selectByText(selectEl: HTMLSelectElement, desired: string | string[]): boolean {
  if (!selectEl?.options) return false

  scrollIntoView(selectEl)
  const options = Array.from(selectEl.options)
    .map((option) => ({
      el: option,
      label: String(option.textContent || '').trim(),
      value: option.value,
    }))
    .filter((option) => option.label)

  const best = pickBestOption(options, desired)
  if (!best) return false

  selectEl.value = (best as { el: HTMLOptionElement }).el.value
  selectEl.dispatchEvent(new Event('change', { bubbles: true }))
  selectEl.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

export async function safeCheck(inputEl: HTMLInputElement | null | undefined, checked: boolean): Promise<boolean> {
  if (!inputEl) return false

  try {
    scrollIntoView(inputEl)
    inputEl.focus?.()

    if (typeof inputEl.click === 'function') {
      if (Boolean(inputEl.checked) !== Boolean(checked)) {
        inputEl.click()
      }
    } else {
      inputEl.checked = Boolean(checked)
    }

    inputEl.dispatchEvent(new Event('change', { bubbles: true }))
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(30)

    return Boolean(inputEl.checked) === Boolean(checked)
  } catch {
    return false
  }
}

export function clickLikeUser(el: Element): void {
  if (!el) return
  scrollIntoView(el)
  ;(el as HTMLElement).focus?.()
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  if (typeof (el as HTMLElement).click === 'function') {
    ;(el as HTMLElement).click()
  }
}

// ---------------------------------------------------------------------------
// 各控件类型的写入入口
// ---------------------------------------------------------------------------

export async function fillCheckboxGroup(
  runtime: FieldRuntime,
  value: string | string[]
): Promise<FillResult> {
  const desired = normalizeCheckboxCandidates(value)
  if (desired.length === 0) {
    return { filled: false, message: '没有可勾选项' }
  }

  let any = false
  for (const option of runtime.options || []) {
    const shouldCheck = matchesAnyCandidate(option.label || option.value, desired)
    const ok = await safeCheck(option.el, shouldCheck)
    if (ok && shouldCheck) any = true
  }

  return any ? { filled: true } : { filled: false, message: '未找到可匹配的多选项' }
}

export async function fillRadioGroup(runtime: FieldRuntime, value: string | string[]): Promise<FillResult> {
  const best = pickBestOption(runtime.options || [], value)
  if (!best) {
    return { filled: false, message: '未找到可匹配的单选项' }
  }

  const ok = await safeCheck((best as { el: HTMLInputElement }).el, true)
  return ok ? { filled: true } : { filled: false, message: '点击单选项失败' }
}

export async function fillSelect(runtime: FieldRuntime, value: string | string[]): Promise<FillResult> {
  const ok = selectByText(runtime.el as HTMLSelectElement, value)
  return ok ? { filled: true } : { filled: false, message: '未找到可匹配的下拉选项' }
}

export async function fillContentEditable(runtime: FieldRuntime, value: string | string[]): Promise<FillResult> {
  const desired = prepareTextValueForRuntime(runtime, value)
  if (!desired) return { filled: false, message: '没有可填写内容' }

  const el = runtime.el as HTMLElement
  scrollIntoView(el)
  el.focus?.()
  el.textContent = desired
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { filled: true }
}

/** text/textarea：直接写入 → 只读日期走面板 → 薪资数值回退 */
export async function fillTextLike(
  runtime: FieldRuntime,
  value: string | string[],
  {
    isDateLike,
    fillDatePanel,
    buildFallbackValues,
  }: {
    isDateLike: boolean
    fillDatePanel: (runtime: FieldRuntime, desired: string) => Promise<boolean>
    buildFallbackValues: (runtime: FieldRuntime, desired: string) => string[]
  }
): Promise<FillResult> {
  let normalized = Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).join(', ')
    : String(value ?? '').trim()

  if (!normalized) return { filled: false, message: '没有可填写内容' }
  normalized = normalizeValueForRuntime(runtime, normalized)
  if (!hasMeaningfulFillValue(normalized)) return { filled: false, message: '没有可填写内容' }

  if (isDateLike) {
    const ok = await fillDatePanel(runtime, normalized)
    return ok ? { filled: true } : { filled: false, message: '日期控件写入失败' }
  }

  const el = runtime.el as HTMLInputElement
  const ok = await setValueWithEvents(el, normalized, runtime)
  if (ok) {
    return { filled: true }
  }

  for (const fallbackValue of buildFallbackValues(runtime, normalized)) {
    const fallbackOk = await setValueWithEvents(el, fallbackValue, runtime)
    if (fallbackOk) {
      return { filled: true, message: `已回退为兼容值 ${fallbackValue}` }
    }
  }

  return { filled: false, message: '写入失败' }
}
