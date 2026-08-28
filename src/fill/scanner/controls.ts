/**
 * 表单控件发现与可见性判定。
 */

export const CONTROL_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

const SKIP_INPUT_TYPES = new Set(['hidden', 'password', 'submit', 'button', 'reset', 'image', 'range', 'color'])

export function isVisible(el: Element): boolean {
  try {
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    const rects = el.getClientRects()
    return rects && rects.length > 0
  } catch {
    return false
  }
}

export function isFillableElement(el: Element): boolean {
  if (!el) return false
  const input = el as HTMLInputElement
  if (input.disabled) return false
  if (el.getAttribute('aria-disabled') === 'true') return false
  return true
}

export function isSkippableInputType(type: string): boolean {
  return SKIP_INPUT_TYPES.has(type)
}

/** 选择器只命中 input/textarea/select/[contenteditable]，皆为 HTMLElement */
export function collectControls(root: ParentNode = document): HTMLElement[] {
  const scope = root || document
  return Array.from(scope.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter((el) => isVisible(el))
}

export function countControls(root: ParentNode = document): number {
  return collectControls(root).length
}

/** 跳过浏览器内部页面之外的判断入口（供选区等场景复用） */
export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }

  return String(value).replace(/["\\]/g, '\\$&')
}
