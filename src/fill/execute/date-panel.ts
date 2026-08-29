/**
 * 只读日期控件的面板式填写：直接写入失败时打开日期面板，
 * 按年份导航 + 点击月份/日期单元格。适配中文（N月/N日）面板。
 */

import type { FieldRuntime } from '../types'
import { normalizeFieldText } from '../scanner/field-text'
import { matchesWrittenValue } from './runtime'
import { clickLikeUser, setValueWithEvents, scrollIntoView } from './dom'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface DatePanelLogger {
  log: (message: string) => void
}

function isVisible(el: Element): boolean {
  try {
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    const rects = el.getClientRects()
    return rects && rects.length > 0
  } catch {
    return false
  }
}

export function parseDateParts(value: string): { year: number; month: number; day: number } {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/)
  if (!match) {
    return { year: 0, month: 0, day: 0 }
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3] || 0),
  }
}

export function findVisibleDatePanel(anchorEl: Element | null): Element | null {
  const candidates = Array.from(
    document.querySelectorAll(
      '[class*="picker"],[class*="Picker"],[class*="calendar"],[class*="Calendar"],[role="dialog"]',
    ),
  ).filter((node) => {
    if (node.contains?.(anchorEl as Node)) return false
    if (!isVisible(node)) return false
    const text = normalizeFieldText(node.textContent || '')
    return /\d{4}年|1月|2月|3月|4月|5月|6月|7月|8月|9月|10月|11月|12月/.test(text)
  })

  if (candidates.length === 0) return null
  if (!anchorEl) return candidates[0]

  const anchorRect = anchorEl.getBoundingClientRect()
  return (
    candidates
      .map((node) => {
        const rect = node.getBoundingClientRect()
        const dx = rect.left - anchorRect.left
        const dy = rect.top - anchorRect.bottom
        return { node, distance: Math.abs(dx) + Math.abs(dy) }
      })
      .sort((left, right) => left.distance - right.distance)[0]?.node || candidates[0]
  )
}

function getVisiblePickerYear(panel: Element): number {
  const nodes = Array.from(panel.querySelectorAll('*'))
  for (const node of nodes) {
    const text = normalizeFieldText(node.textContent || '')
    const match = text.match(/^(\d{4})年$/)
    if (match) {
      return Number(match[1])
    }
  }
  return 0
}

function findYearNavigationControl(panel: Element, currentYear: number, targetYear: number): Element | null {
  const buttons = Array.from(
    panel.querySelectorAll(
      'button,[role="button"],[tabindex],[class*="prev"],[class*="next"],[class*="arrow"],[class*="Arrow"]',
    ),
  ).filter((node) => isVisible(node))

  if (buttons.length === 0) return null

  const yearNode = Array.from(panel.querySelectorAll('*')).find((node) =>
    /^\d{4}年$/.test(normalizeFieldText(node.textContent || '')),
  )
  if (!yearNode) {
    return targetYear < currentYear ? buttons[0] : buttons[buttons.length - 1]
  }

  const yearRect = yearNode.getBoundingClientRect()
  const leftButtons: Array<{ button: Element; right: number }> = []
  const rightButtons: Array<{ button: Element; left: number }> = []

  for (const button of buttons) {
    const rect = button.getBoundingClientRect()
    if (rect.right <= yearRect.left) {
      leftButtons.push({ button, right: rect.right })
    } else if (rect.left >= yearRect.right) {
      rightButtons.push({ button, left: rect.left })
    }
  }

  if (targetYear < currentYear) {
    return leftButtons.sort((a, b) => b.right - a.right)[0]?.button || buttons[0]
  }

  return rightButtons.sort((a, b) => a.left - b.left)[0]?.button || buttons[buttons.length - 1]
}

async function movePickerToYear(panel: Element, targetYear: number): Promise<boolean> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const currentYear = getVisiblePickerYear(panel)
    if (!currentYear) return true
    if (currentYear === targetYear) return true

    const control = findYearNavigationControl(panel, currentYear, targetYear)
    if (!control) return false

    clickLikeUser(control)
    await sleep(120)
  }

  return false
}

export async function clickPanelCell(panel: Element, text: string): Promise<boolean> {
  const normalizedTarget = normalizeFieldText(text)
  const candidates = Array.from(panel.querySelectorAll('button,[role="button"],td,li,div,span')).filter(
    (node) => {
      if (!isVisible(node)) return false
      if (node.getAttribute?.('aria-disabled') === 'true') return false
      const className = String((node as HTMLElement).className || '')
      if (/disabled/i.test(className)) return false
      return normalizeFieldText(node.textContent || '') === normalizedTarget
    },
  )

  if (candidates.length === 0) return false

  const target = candidates.sort((left, right) => {
    const leftArea = left.getBoundingClientRect().width * left.getBoundingClientRect().height
    const rightArea = right.getBoundingClientRect().width * right.getBoundingClientRect().height
    return leftArea - rightArea
  })[0]

  clickLikeUser(target)
  await sleep(80)
  return true
}

export async function fillReadonlyDateRuntime(
  runtime: FieldRuntime,
  desired: string,
  logger?: DatePanelLogger
): Promise<boolean> {
  const log = (step: string, detail = '') => {
    if (!logger) return
    const label = runtime?.label || runtime?.placeholder || '(empty)'
    logger.log(detail ? `[日期] ${runtime.fieldId} "${label}" ${step} detail="${detail}"` : `[日期] ${runtime.fieldId} "${label}" ${step}`)
  }

  log('开始', `目标值=${desired}`)

  const el = runtime.el as HTMLInputElement
  const directWriteOk = await setValueWithEvents(el, desired, runtime)
  if (directWriteOk) {
    log('直接写入成功')
    return true
  }

  log('直接写入失败', '尝试打开日期面板')

  const trigger = el.closest?.('.mtd-input-affix-wrapper') || el
  clickLikeUser(trigger)
  await sleep(120)

  let panel = findVisibleDatePanel(el)
  if (!panel) {
    clickLikeUser(el)
    await sleep(120)
    panel = findVisibleDatePanel(el)
  }

  if (!panel) {
    log('打开面板失败')
    return false
  }

  const parsed = parseDateParts(desired)
  if (!parsed.year || !parsed.month) {
    log('解析目标日期失败', desired)
    return false
  }

  log('面板已打开', `year=${parsed.year} month=${parsed.month} day=${parsed.day || 0}`)

  const yearReady = await movePickerToYear(panel, parsed.year)
  if (!yearReady) {
    log('年份切换失败', String(parsed.year))
    return false
  }

  panel = findVisibleDatePanel(el) || panel
  const monthLabel = `${Number(parsed.month)}月`
  if (!(await clickPanelCell(panel, monthLabel))) {
    log('月份点击失败', monthLabel)
    return false
  }

  log('月份点击成功', monthLabel)
  await sleep(120)

  if (parsed.day) {
    panel = findVisibleDatePanel(el) || panel
    const dayOk = await clickPanelCell(panel, String(Number(parsed.day)))
    if (!dayOk) {
      log('日期点击失败', String(Number(parsed.day)))
      return false
    }
    log('日期点击成功', String(Number(parsed.day)))
    await sleep(120)
  }

  const matched = matchesWrittenValue(runtime, el.value, desired)
  log(matched ? '最终校验成功' : '最终校验失败', `当前值=${el.value || '(empty)'}`)
  return matched
}

export { scrollIntoView }
