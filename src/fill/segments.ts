/**
 * 分块多步填充：把扫描到的字段按 DOM 分组聚类成「块」，并等待块间翻页。
 * 纯逻辑（detectFormSegments/按钮候选规则）与 DOM 编排（waitForSegmentChange）分离。
 */

import type { FieldDescriptor, FieldRuntime } from './types'
import { isVisible } from './scanner/controls'

export interface FormSegment {
  key: string
  fieldIds: string[]
  rootEl: HTMLElement | null
}

export interface NextStepCandidate {
  text: string
  el: Element
}

const SEGMENT_ROOT_SELECTOR = 'form, fieldset, section, [role="group"], [class*="form-item"], [class*="form-block"], [class*="step-content"]'
const MAX_FALLBACK_FIELDS_PER_SEGMENT = 8

/** 字段最近的分组祖先；无分组返回 null */
function findSegmentRoot(el: Element | null | undefined): HTMLElement | null {
  if (!el?.closest) return null
  return el.closest(SEGMENT_ROOT_SELECTOR)
}

/**
 * 把字段聚类成块：同一分组祖先 → 同块；无分组祖先的按文档顺序兜底分块。
 * 顺序保持扫描顺序（fields 数组序）。
 */
export function detectFormSegments(
  fields: FieldDescriptor[],
  runtimeMap: Map<string, FieldRuntime>
): FormSegment[] {
  const segments: FormSegment[] = []
  const rootToSegment = new Map<HTMLElement, FormSegment>()
  let fallbackIndex = 0

  for (const field of fields) {
    const runtime = runtimeMap.get(field.fieldId)
    const root = findSegmentRoot(runtime?.el)

    if (root) {
      let segment = rootToSegment.get(root)
      if (!segment) {
        segment = { key: `seg-root-${segments.length}`, fieldIds: [], rootEl: root }
        rootToSegment.set(root, segment)
        segments.push(segment)
      }
      segment.fieldIds.push(field.fieldId)
      continue
    }

    // 无分组祖先：每 MAX_FALLBACK_FIELDS_PER_SEGMENT 个字段一块
    let segment = segments[segments.length - 1]
    const isFallbackTail = segment && segment.rootEl === null && segment.fieldIds.length < MAX_FALLBACK_FIELDS_PER_SEGMENT
    if (!isFallbackTail) {
      fallbackIndex += 1
      segment = { key: `seq-${fallbackIndex}`, fieldIds: [], rootEl: null }
      segments.push(segment)
    }
    segment!.fieldIds.push(field.fieldId)
  }

  return segments
}

const NEXT_STEP_PATTERN = /(下一步|下一页|保存|提交|确认|继续|保存并|保存并下一步|进入下一步)/
const EXCLUDE_PATTERN = /(取消|上一步|返回|重置|清空|删除)/

/** 全页（或指定容器）可见的「下一步/提交」类按钮候选（排除取消/上一步等） */
export function findNextStepCandidates(root?: ParentNode | null): NextStepCandidate[] {
  const scope = root || (typeof document !== 'undefined' ? document : null)
  if (!scope?.querySelectorAll) return []

  const buttons = Array.from(
    scope.querySelectorAll('button, input[type="submit"], a[role="button"], a.btn, [class*="next"], [class*="submit"]')
  )

  const out: NextStepCandidate[] = []
  for (const el of buttons) {
    const text = String((el as HTMLElement).textContent || (el as HTMLInputElement).value || '').trim()
    if (!text || text.length > 30) continue
    if (!NEXT_STEP_PATTERN.test(text)) continue
    if (EXCLUDE_PATTERN.test(text)) continue
    if (!isVisible(el)) continue
    if ((el as HTMLButtonElement).disabled) continue
    out.push({ text, el })
  }
  return out
}

export interface WaitForSegmentChangeOptions {
  timeoutMs?: number
  pollMs?: number
}

/**
 * 等待「块内字段元素被替换/移除」（用户点了下一步，SPA 重渲染）。
 * 轮询存活检测：字段元素从 document 脱离即视为翻页。
 */
export async function waitForSegmentChange(
  fieldEls: Element[],
  { timeoutMs = 15000, pollMs = 400 }: WaitForSegmentChangeOptions = {}
): Promise<boolean> {
  if (fieldEls.length === 0) return false

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const anyDetached = fieldEls.some((el) => !el.isConnected)
    if (anyDetached) return true
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  return false
}
