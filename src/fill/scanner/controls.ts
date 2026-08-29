/**
 * 表单控件发现与可见性判定。
 */

export const CONTROL_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="combobox"]'

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

/** 选择器只命中 input/textarea/select/[contenteditable]/[role=combobox]，皆为 HTMLElement */
export function collectControls(root: ParentNode = document): HTMLElement[] {
  const scope = root || document
  const own = Array.from(scope.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter((el) => isVisible(el))
  return [...own, ...collectSameOriginIframeControls(scope)]
}

/**
 * 同源 iframe：顶层帧的 contentDocument 可直接遍历（无需 all_frames 注入）。
 * 跨域 iframe 的 contentDocument 为 null，静默跳过——那些帧由扩展在各自帧内
 * 独立注入 content script 自行扫描（若声明 all_frames）。深度封顶防嵌套地狱。
 */
function collectSameOriginIframeControls(scope: ParentNode, depth = 0, seen = new Set<Document>()): HTMLElement[] {
  if (depth > 3) return []

  const out: HTMLElement[] = []
  const iframes = Array.from(scope.querySelectorAll('iframe'))

  for (const iframe of iframes) {
    let doc: Document | null = null
    try {
      doc = iframe.contentDocument
    } catch {
      doc = null // 跨域访问抛 SecurityError
    }
    if (!doc || seen.has(doc)) continue
    seen.add(doc)

    out.push(
      ...Array.from(doc.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter((el) => isVisible(el)),
    )
    out.push(...collectSameOriginIframeControls(doc, depth + 1, seen))
  }

  return out
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
