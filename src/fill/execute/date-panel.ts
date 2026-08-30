/**
 * 只读日期控件的面板式填写：直接写入失败时打开日期面板，
 * 按年份导航 + 点击月份/日期单元格。适配中文（N月/N日）面板。
 */

import type { FieldRuntime } from '../types'
import { normalizeFieldText } from '../scanner/field-text'
import { normalizeDateValue } from '@/resume/schema'
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

/** 面板候选选择器：覆盖常见组件库（picker/calendar/datepicker）与自研容器（dropdown/popup） */
const DATE_PANEL_SELECTOR = [
  '[class*="picker"]',
  '[class*="Picker"]',
  '[class*="calendar"]',
  '[class*="Calendar"]',
  '[class*="datepicker"]',
  '[class*="DatePicker"]',
  '[class*="dropdown"]',
  '[class*="Dropdown"]',
  '[class*="popup"]',
  '[class*="Popup"]',
  '[role="dialog"]',
].join(',')

const MONTH_TEXT_PATTERN = /\d{4}年|1月|2月|3月|4月|5月|6月|7月|8月|9月|10月|11月|12月/

/** 日格数量：内嵌式面板（包含输入框本体）必须有足够日期格才认定，防把表单容器误判成面板 */
function countDayCells(node: Element): number {
  return Array.from(node.querySelectorAll('td,li,button,span,div')).filter((cell) => {
    if (cell.children.length > 0) return false
    return /^(?:[1-9]|[12]\d|3[01])$/.test(normalizeFieldText(cell.textContent || ''))
  }).length
}

export function findVisibleDatePanel(anchorEl: Element | null): Element | null {
  const nodes = Array.from(document.querySelectorAll(DATE_PANEL_SELECTOR)).filter((node) => {
    if (!isVisible(node)) return false
    const text = normalizeFieldText(node.textContent || '')
    return MONTH_TEXT_PATTERN.test(text)
  })

  const containsAnchor = (node: Element) =>
    Boolean(anchorEl && typeof node.contains === 'function' && node.contains(anchorEl as Node))
  const outside = nodes.filter((node) => !containsAnchor(node))
  // portal 式面板不含输入框；内嵌式面板包住输入框，要求带日期格才算
  const inside = nodes.filter((node) => containsAnchor(node) && countDayCells(node) >= 5)

  const pool = outside.length > 0 ? outside : inside
  if (pool.length === 0) return null
  if (!anchorEl) return pool[0]

  const anchorRect = anchorEl.getBoundingClientRect()
  return (
    pool
      .map((node) => {
        const rect = node.getBoundingClientRect()
        const dx = rect.left - anchorRect.left
        const dy = rect.top - anchorRect.bottom
        return { node, distance: Math.abs(dx) + Math.abs(dy) }
      })
      .sort((left, right) => left.distance - right.distance)[0]?.node || pool[0]
  )
}

/** 面板文本 → 年份：「2020年」「2020年8月」或年份下拉里的纯「2020」 */
export function matchYearText(text: string): number | null {
  const normalized = normalizeFieldText(text)
  const withUnit = normalized.match(/^(\d{4})\s*年/)
  if (withUnit) return Number(withUnit[1])
  if (/^\d{4}$/.test(normalized)) return Number(normalized)
  return null
}

function getVisiblePickerYear(panel: Element): number {
  for (const node of Array.from(panel.querySelectorAll('*'))) {
    const year = matchYearText(node.textContent || '')
    if (year) return year
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
    Boolean(matchYearText(node.textContent || '')),
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

/** 点击文本完全匹配的面板单元格；接受多个候选写法（8月/08月、8/08） */
export async function clickPanelCell(panel: Element, ...texts: string[]): Promise<boolean> {
  const targets = texts.map((text) => normalizeFieldText(text)).filter(Boolean)
  if (targets.length === 0) return false

  const candidates = Array.from(panel.querySelectorAll('button,[role="button"],td,li,div,span')).filter(
    (node) => {
      if (!isVisible(node)) return false
      if (node.getAttribute?.('aria-disabled') === 'true') return false
      const className = String((node as HTMLElement).className || '')
      if (/disabled/i.test(className)) return false
      return targets.includes(normalizeFieldText(node.textContent || ''))
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

/** 读回控件展示值：input.value 为空时回退读外层容器的日期文本（自研组件常渲染在兄弟节点） */
export function readDisplayedDateValue(el: HTMLInputElement): string {
  const own = String(el?.value ?? '').trim()
  if (own) return own

  const wrapper = el?.closest?.(
    '[class*="picker"],[class*="Picker"],[class*="dropdown"],[class*="Dropdown"],[class*="calendar"],[class*="Calendar"]',
  )
  const text = String((wrapper as HTMLElement | null)?.textContent || '')
  const match = text.match(/\d{4}\s*[-/.年]\s*\d{1,2}(?:\s*[-/.月]\s*\d{1,2}\s*日?)?/)
  return match ? normalizeDateValue(match[0]) : ''
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

  // 逐个尝试触发器：输入框本体 → 输入框父容器（图标常在父级）。面板已出现即停，避免二次点击把面板点收起
  const trigger = el.closest?.(
    '.mtd-input-affix-wrapper, [class*="input-group"], [class*="InputGroup"], [class*="input-wrapper"], [class*="InputWrapper"]',
  )
  const clickCandidates = [trigger, el.parentElement, el].filter(Boolean) as Element[]
  let panel: Element | null = null

  for (const candidate of clickCandidates) {
    clickLikeUser(candidate)
    await sleep(150)
    panel = findVisibleDatePanel(el)
    if (panel) break
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

  const month = Number(parsed.month)
  panel = findVisibleDatePanel(el) || panel
  if (!(await clickPanelCell(panel, `${month}月`, `${String(month).padStart(2, '0')}月`))) {
    log('月份点击失败', `${month}月`)
    return false
  }

  log('月份点击成功', `${month}月`)
  await sleep(120)

  if (parsed.day) {
    const day = Number(parsed.day)
    panel = findVisibleDatePanel(el) || panel
    const dayOk = await clickPanelCell(panel, String(day), String(day).padStart(2, '0'))
    if (!dayOk) {
      log('日期点击失败', String(day))
      return false
    }
    log('日期点击成功', String(day))
    await sleep(120)
  }

  const displayed = readDisplayedDateValue(el)
  const matched = matchesWrittenValue(runtime, displayed, desired)
  log(matched ? '最终校验成功' : '最终校验失败', `当前值=${displayed || '(empty)'}`)
  return matched
}

export { scrollIntoView }
