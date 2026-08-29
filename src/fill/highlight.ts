/**
 * 填充字段高亮：给已填元素加类 + data 标记，自动延迟清除。
 * 只加类与 data 属性、不动 inline style，类移除即还原，零副作用。
 */

import type { FieldRuntime } from './types'

const HIGHLIGHT_CLASS = 'offer-pilot-filled'
const HIGHLIGHT_ATTR = 'data-offer-pilot-highlight'
export const HIGHLIGHT_AUTO_CLEAR_MS = 6000

let autoClearTimer: ReturnType<typeof setTimeout> | null = null

function markElement(el: Element | null | undefined): void {
  if (!el) return
  el.classList.add(HIGHLIGHT_CLASS)
  el.setAttribute(HIGHLIGHT_ATTR, '1')
}

/** 对成功填充的 runtime（含选项组）显示高亮 */
export function showFieldHighlights(runtimes: FieldRuntime[]): void {
  for (const runtime of runtimes || []) {
    if (!runtime) continue
    if (runtime.kind === 'radio_group' || runtime.kind === 'checkbox_group') {
      for (const option of runtime.options || []) {
        markElement(option?.el)
      }
      continue
    }
    markElement(runtime.el)
  }
}

/** 清除页面上全部高亮标记（按 data 属性全局查，避免类名冲突误伤） */
export function clearFieldHighlights(): void {
  if (typeof document === 'undefined') return
  document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_CLASS)
    el.removeAttribute(HIGHLIGHT_ATTR)
  })
}

/** 重新调度自动清除；重复调用会重置计时器。ms=0 表示不自动清除（保留到下次填充） */
export function scheduleHighlightAutoClear(ms: number = HIGHLIGHT_AUTO_CLEAR_MS): void {
  if (autoClearTimer) {
    clearTimeout(autoClearTimer)
    autoClearTimer = null
  }
  if (ms <= 0) return
  autoClearTimer = setTimeout(() => {
    autoClearTimer = null
    clearFieldHighlights()
  }, ms)
}

/** 供测试取消挂起的计时器 */
export function cancelHighlightAutoClear(): void {
  if (autoClearTimer) {
    clearTimeout(autoClearTimer)
    autoClearTimer = null
  }
}
