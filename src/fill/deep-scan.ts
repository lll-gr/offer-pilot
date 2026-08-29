/**
 * 深度扫描：填充前自动点击"展开/查看更多"类按钮，暴露折叠的表单区块。
 * 带安全护栏：排除提交/新增/删除类按钮，限制轮数与点击数。
 */

import { normalizeFieldText } from './scanner/field-text'
import { countControls, isVisible } from './scanner/controls'
import { clickLikeUser, scrollIntoView } from './execute/dom'

const DEEP_SCAN_MAX_ROUNDS = 5
const DEEP_SCAN_INITIAL_DELAY = 250
const DEEP_SCAN_POLL_TIMEOUT = 1200
const DEEP_SCAN_MAX_CLICKS = 20

const DEEP_SCAN_EXPAND_KEYWORDS = ['展开', '展开全部', '查看更多', '查看全部', 'showmore', 'viewmore', 'expand']
const DEEP_SCAN_MORE_KEYWORDS = ['更多', 'more']
const DEEP_SCAN_EXCLUDE_KEYWORDS = [
  '添加', '新增', '增加', '新建', '删除', '提交', '保存', '返回', '取消', '关闭',
  'add', 'new', 'plus', 'delete', 'submit', 'save', 'back', 'cancel', 'close',
]

/** 按钮文案 → 简历区块 key（只展开与已填内容相关的区块） */
const DEEP_SCAN_SECTION_MAP: Array<{ patterns: string[]; sectionKey: string }> = [
  { patterns: ['教育', '学校', '专业', '学历', '学位', '毕业'], sectionKey: 'educations' },
  { patterns: ['实习'], sectionKey: 'internships' },
  { patterns: ['工作', '公司', '职位', '任职', '职业'], sectionKey: 'workExperiences' },
  { patterns: ['项目', '产品'], sectionKey: 'projects' },
  { patterns: ['证书', '认证', '资格', '等级'], sectionKey: 'certificates' },
  { patterns: ['语言', '外语', '雅思', '托福', 'cet'], sectionKey: 'languages' },
  { patterns: ['校园', '学生', '社团', '社会', '志愿', '科研', '组织'], sectionKey: 'campusExperiences' },
  { patterns: ['技能', '特长', '编程', '工具'], sectionKey: 'skills' },
  { patterns: ['偏好', '期望', '求职', '目标', '薪资'], sectionKey: 'jobPreferences' },
  { patterns: ['联系方式', '地址', '电话'], sectionKey: 'contactAndLocation' },
  { patterns: ['证件', '身份', '护照', '户口'], sectionKey: 'identityAndAuthorization' },
  { patterns: ['补充', '其他', '备注', '说明'], sectionKey: 'additional' },
]

function normalizeDeepScanText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[＊*]+$/g, '')
    .trim()
}

function getDeepScanText(el: Element): string {
  return normalizeDeepScanText(
    [el?.textContent, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title')]
      .filter(Boolean)
      .join(' '),
  )
}

function getDeepScanTargetElements(el: Element): Element[] {
  const targets: Element[] = []
  const targetIds = [
    el?.getAttribute?.('aria-controls'),
    el?.getAttribute?.('data-target'),
    el?.getAttribute?.('data-toggle-target'),
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\s+/))

  for (const targetId of targetIds) {
    const normalizedTargetId = targetId.startsWith('#') ? targetId.slice(1) : targetId
    const target = el?.ownerDocument?.getElementById?.(normalizedTargetId)
    if (target) targets.push(target)
  }

  const href = el?.getAttribute?.('href') || ''
  if (href.startsWith('#')) {
    const target = el?.ownerDocument?.getElementById?.(href.slice(1))
    if (target) targets.push(target)
  }

  return targets
}

function hasHiddenDeepScanTarget(el: Element): boolean {
  return getDeepScanTargetElements(el).some((target) => {
    if ((target as HTMLElement).hidden || target.getAttribute?.('aria-hidden') === 'true') {
      return true
    }
    return !isVisible(target)
  })
}

/** 判定元素是否为可安全点击的"展开"触发器（纯函数，测试友好） */
export function isDeepScanExpandTrigger(el: Element): boolean {
  if (!el) return false
  const tagName = String(el.tagName || '').toLowerCase()
  const role = String(el.getAttribute?.('role') || '').toLowerCase()
  if (tagName !== 'button' && tagName !== 'a' && role !== 'button') {
    return false
  }
  const control = el as HTMLButtonElement
  if (control.disabled || el.getAttribute?.('aria-disabled') === 'true') {
    return false
  }
  if (String(el.getAttribute?.('type') || '').toLowerCase() === 'submit') {
    return false
  }
  if (el.getAttribute?.('aria-haspopup')) return false
  if (el.getAttribute?.('aria-expanded') === 'true') return false

  const text = getDeepScanText(el)
  if (!text || DEEP_SCAN_EXCLUDE_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return false
  }

  const className = normalizeDeepScanText((el as HTMLElement).className || '')
  const hasExplicitExpandText = DEEP_SCAN_EXPAND_KEYWORDS.some((keyword) => text.includes(keyword))
  const hasCollapsedState =
    el.getAttribute?.('aria-expanded') === 'false' ||
    el.getAttribute?.('data-expanded') === 'false' ||
    hasHiddenDeepScanTarget(el)
  const hasExpandClass = /(^|[-_])expand(?:ed|able)?([_-]|$)/.test(className)
  const hasMoreText = DEEP_SCAN_MORE_KEYWORDS.some((keyword) => text.includes(keyword))

  if (hasExplicitExpandText) return true
  if (hasExpandClass && hasCollapsedState) return true
  return hasMoreText && hasCollapsedState
}

function hasSectionContent(profile: Record<string, unknown>, sectionKey: string): boolean {
  const section = profile?.[sectionKey]
  if (!section) return false
  if (Array.isArray(section)) {
    return section.some((item) =>
      item && typeof item === 'object'
        ? Object.values(item).some((value) => String(value || '').trim())
        : Boolean(String(item || '').trim()),
    )
  }
  if (typeof section === 'object') {
    return Object.values(section).some((value) => String(value || '').trim())
  }
  return Boolean(String(section).trim())
}

function deepScanButtonMatchesProfile(el: Element, resumeProfile: Record<string, unknown>): boolean {
  if (!resumeProfile) return true
  const text = getDeepScanText(el)
  const matchedSections = DEEP_SCAN_SECTION_MAP.filter((entry) =>
    entry.patterns.some((pattern) => text.includes(normalizeDeepScanText(pattern))),
  )
  if (matchedSections.length === 0) return true
  return matchedSections.some((entry) => hasSectionContent(resumeProfile, entry.sectionKey))
}

function findDeepScanButtons(clickedElements: WeakSet<Element>, resumeProfile: Record<string, unknown>): Element[] {
  const selectors = [
    'button:not([type="submit"])',
    '[role="button"]',
    'a[class*="expand"], a[class*="Expand"]',
    'a[class*="more"], a[class*="More"]',
  ]
  return Array.from(document.querySelectorAll(selectors.join(','))).filter((el) => {
    if (!isVisible(el) || clickedElements.has(el)) return false
    return isDeepScanExpandTrigger(el) && deepScanButtonMatchesProfile(el, resumeProfile)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForNewFields(startCount: number): Promise<boolean> {
  if (countControls(document) > startCount) return true

  return new Promise((resolve) => {
    let settled = false
    let initialTimer: ReturnType<typeof setTimeout> | null = null
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    const observer =
      typeof MutationObserver === 'function' ? new MutationObserver(check) : null

    function finish(found: boolean) {
      if (settled) return
      settled = true
      if (initialTimer) clearTimeout(initialTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      observer?.disconnect()
      resolve(found)
    }

    function check() {
      if (countControls(document) > startCount) {
        finish(true)
      }
    }

    observer?.observe(document.body || document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style', 'aria-hidden'],
    })
    initialTimer = setTimeout(check, DEEP_SCAN_INITIAL_DELAY)
    timeoutTimer = setTimeout(() => finish(false), DEEP_SCAN_POLL_TIMEOUT)
  })
}

/** 返回点击的展开按钮数量 */
export async function triggerExpandableSections(
  resumeProfile: Record<string, unknown>,
  log: (message: string) => void = () => {},
  { maxRounds = DEEP_SCAN_MAX_ROUNDS }: { maxRounds?: number } = {}
): Promise<number> {
  const clickedElements = new WeakSet<Element>()
  let totalClicked = 0

  for (let round = 0; round < maxRounds && totalClicked < DEEP_SCAN_MAX_CLICKS; round += 1) {
    const buttons = findDeepScanButtons(clickedElements, resumeProfile)
    if (buttons.length === 0) break

    log(`深度扫描第 ${round + 1} 轮：发现 ${buttons.length} 个可展开区块`)

    for (const button of buttons.slice(0, DEEP_SCAN_MAX_CLICKS - totalClicked)) {
      const startCount = countControls(document)
      scrollIntoView(button)
      clickLikeUser(button)
      clickedElements.add(button)
      totalClicked += 1

      if (await waitForNewFields(startCount)) {
        log(`已触发第 ${totalClicked} 个展开按钮，检测到新字段`)
      }
    }
  }

  if (totalClicked > 0) {
    log(`深度扫描完成：共触发 ${totalClicked} 个展开按钮`)
  }
  return totalClicked
}

export { normalizeFieldText }
