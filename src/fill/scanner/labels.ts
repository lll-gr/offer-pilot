/**
 * 字段标签与上下文提取：aria/label/placeholder/相邻节点/区块标题，
 * 输出 FieldDescriptor 所需的语义元信息。
 */

import { inferSectionFromTexts } from './semantics'
import {
  isMeaningfulFieldText,
  normalizeFieldText,
  selectBestFieldTextCandidate,
} from './field-text'
import { CONTROL_SELECTOR, cssEscape } from './controls'
import type { FieldKind } from '../types'

export const LABEL_LIKE_SELECTOR =
  '[class*="label"],[class*="Label"],[class*="title"],[class*="Title"],[class*="name"],[class*="Name"],[class*="caption"],[class*="Caption"],[class*="header"],[class*="Header"],label,legend,dt,th'
export const HEADING_LIKE_SELECTOR =
  'h1,h2,h3,h4,h5,h6,[role="heading"],[class*="section"],[class*="Section"],[class*="header"],[class*="Header"],[class*="title"],[class*="Title"],legend'
export const STRUCTURAL_CONTAINER_SELECTOR =
  '[class*="form"],[class*="Form"],[class*="field"],[class*="Field"],[class*="item"],[class*="Item"],[class*="row"],[class*="Row"],[class*="group"],[class*="Group"],[class*="cell"],[class*="Cell"],fieldset,section,article,tr,li,td,th,dl'

export interface FieldSemanticMeta {
  label: string
  context: string
  sectionKey: string
  sectionLabel: string
  sectionEvidence: string
  nearbyLabels: string[]
}

function pushUniqueMeaningfulText(list: string[], value: unknown): void {
  const text = normalizeFieldText(value || '')
  if (!isMeaningfulFieldText(text)) return
  if (!list.includes(text)) {
    list.push(text)
  }
}

function pushTextFromNode(
  list: string[],
  node: Element | null | undefined,
  { skipNode = null, maxLength = 120 }: { skipNode?: Element | null; maxLength?: number } = {}
): void {
  pushUniqueMeaningfulText(list, getNodeTextWithoutControls(node, { skipNode, maxLength }))
}

export function getNodeTextWithoutControls(
  node: Element | null | undefined,
  { skipNode = null, maxLength = 200 }: { skipNode?: Element | null; maxLength?: number } = {}
): string {
  if (!node) return ''

  try {
    const clone = node.cloneNode(true) as Element
    const selectors = [CONTROL_SELECTOR]

    if (skipNode?.id) {
      selectors.push(`#${cssEscape(skipNode.id)}`)
    }

    for (const child of clone.querySelectorAll(selectors.join(','))) {
      child.remove()
    }

    const text = normalizeFieldText(clone.textContent || '')
    if (!isMeaningfulFieldText(text)) {
      return ''
    }

    return maxLength && text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
  } catch {
    return ''
  }
}

export function collectDirectFieldLabelCandidates(el: Element): string[] {
  const candidates: string[] = []

  pushUniqueMeaningfulText(candidates, el.getAttribute?.('aria-label'))

  const labelledBy = el.getAttribute?.('aria-labelledby')
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/g)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((node) => normalizeFieldText(node?.textContent || ''))

    for (const part of parts) {
      pushUniqueMeaningfulText(candidates, part)
    }
  }

  const id = (el as HTMLElement).id
  if (id) {
    const forLabel = document.querySelector(`label[for="${cssEscape(id)}"]`)
    pushUniqueMeaningfulText(candidates, forLabel?.textContent || '')
  }

  const wrapping = el.closest?.('label')
  pushUniqueMeaningfulText(candidates, wrapping?.textContent || '')

  pushUniqueMeaningfulText(candidates, el.getAttribute?.('placeholder') || '')
  pushUniqueMeaningfulText(candidates, el.getAttribute?.('name') || '')

  return candidates
}

export function collectRelevantContainers(el: Element): Element[] {
  const containers: Element[] = []
  let current = el.parentElement

  while (current && containers.length < 4) {
    if (current.matches?.(STRUCTURAL_CONTAINER_SELECTOR)) {
      containers.push(current)
    }
    current = current.parentElement
  }

  if (containers.length === 0 && el.parentElement) {
    containers.push(el.parentElement)
  }

  return containers
}

export function getStructuralContainer(el: Element): Element {
  return collectRelevantContainers(el)[0] || el.parentElement || el
}

export function collectNearbyLabelCandidates(el: Element): string[] {
  const candidates: string[] = []
  const containers = collectRelevantContainers(el)

  for (const container of containers) {
    for (const child of Array.from(container.children || [])) {
      if (child === el || child.contains?.(el)) continue

      pushTextFromNode(candidates, child, { skipNode: el, maxLength: 120 })

      const nestedNodes = child.querySelectorAll?.(LABEL_LIKE_SELECTOR)
      for (const node of nestedNodes || []) {
        pushTextFromNode(candidates, node, { skipNode: el, maxLength: 120 })
      }
    }
  }

  let current: Element | null = el
  for (let depth = 0; current && depth < 4; depth += 1) {
    pushTextFromNode(candidates, current.previousElementSibling, { skipNode: el, maxLength: 120 })
    pushTextFromNode(candidates, current.nextElementSibling, { skipNode: el, maxLength: 120 })
    current = current.parentElement
  }

  return candidates
}

export function collectSectionTextCandidates(el: Element): string[] {
  const candidates: string[] = []
  let current: Element | null = getStructuralContainer(el)
  let depth = 0

  while (current && depth < 6) {
    const headingNodes = current.querySelectorAll?.(HEADING_LIKE_SELECTOR)
    for (const node of headingNodes || []) {
      if (node === el || node.contains?.(el)) continue
      pushTextFromNode(candidates, node, { skipNode: el, maxLength: 80 })
    }

    let sibling = current.previousElementSibling
    let siblingDepth = 0
    while (sibling && siblingDepth < 3) {
      pushTextFromNode(candidates, sibling, { skipNode: el, maxLength: 80 })
      const nestedNodes = sibling.querySelectorAll?.(`${HEADING_LIKE_SELECTOR},${LABEL_LIKE_SELECTOR}`)
      for (const node of nestedNodes || []) {
        pushTextFromNode(candidates, node, { skipNode: el, maxLength: 80 })
      }
      sibling = sibling.previousElementSibling
      siblingDepth += 1
    }

    current = current.parentElement?.closest?.(STRUCTURAL_CONTAINER_SELECTOR) || current.parentElement
    depth += 1
  }

  return candidates
}

function selectFallbackFieldLabel(
  candidates: string[],
  { kind = 'text', inputType = '', sectionLabel = '' }: { kind?: FieldKind | string; inputType?: string; sectionLabel?: string } = {}
): string {
  const filtered = candidates.filter((text) => {
    if (kind === 'text' && /^(描述|补充说明|说明|内容|详情)$/.test(text)) {
      return false
    }
    return true
  })

  const best = selectBestFieldTextCandidate(filtered)
  if (best) return best

  if (!sectionLabel) return ''
  if (inputType === 'url') return `${sectionLabel}链接字段`
  if (inputType === 'date' || inputType === 'month') return `${sectionLabel}时间字段`
  if (kind === 'textarea' || kind === 'contenteditable') return `${sectionLabel}描述字段`
  return `${sectionLabel}字段`
}

export function getFieldContext(
  el: Element,
  { label = '', nearbyLabels = [], sectionLabel = '' }: { label?: string; nearbyLabels?: string[]; sectionLabel?: string } = {}
): string {
  const container = getStructuralContainer(el)
  const text = getNodeTextWithoutControls(container, { skipNode: el, maxLength: 240 })
  if (text) {
    return text.length > 160 ? `${text.slice(0, 157)}...` : text
  }

  const fallbackParts: string[] = []
  pushUniqueMeaningfulText(fallbackParts, sectionLabel)
  for (const item of nearbyLabels) {
    if (item === label) continue
    pushUniqueMeaningfulText(fallbackParts, item)
  }

  const fallback = fallbackParts.slice(0, 3).join(' / ')
  if (!fallback) return ''
  return fallback.length > 160 ? `${fallback.slice(0, 157)}...` : fallback
}

export function buildFieldSemanticMeta(
  el: Element,
  { kind = 'text', inputType = '' }: { kind?: FieldKind | string; inputType?: string } = {}
): FieldSemanticMeta {
  const primaryCandidates = collectDirectFieldLabelCandidates(el)
  const nearbyLabels = collectNearbyLabelCandidates(el).slice(0, 6)
  const rawLabel = selectBestFieldTextCandidate(primaryCandidates)
  const filteredNearbyLabels = nearbyLabels.filter((item) => item !== rawLabel)
  const section = inferSectionFromTexts([
    rawLabel,
    ...filteredNearbyLabels,
    ...collectSectionTextCandidates(el),
  ])

  const label =
    rawLabel ||
    selectFallbackFieldLabel(filteredNearbyLabels, {
      kind,
      inputType,
      sectionLabel: section.label,
    })

  return {
    label,
    context: getFieldContext(el, {
      label,
      nearbyLabels: filteredNearbyLabels,
      sectionLabel: section.label,
    }),
    sectionKey: section.key || '',
    sectionLabel: section.label || '',
    sectionEvidence: section.evidence || '',
    nearbyLabels: filteredNearbyLabels.slice(0, 4),
  }
}

export function getGroupLabel(input: Element): string {
  const fieldset = input.closest?.('fieldset')
  const legendText = normalizeFieldText(fieldset?.querySelector?.('legend')?.textContent || '')
  if (legendText) return legendText

  const container =
    input.closest?.(
      '[class*="form"],[class*="Form"],[class*="field"],[class*="Field"],[class*="item"],[class*="Item"],[class*="row"],[class*="Row"]',
    ) || input.parentElement

  const text = normalizeFieldText(container?.textContent || '')
  return text ? text.slice(0, 80) : ''
}

export function getOptionLabel(input: HTMLInputElement): string {
  const id = input.id
  if (id) {
    const forLabel = document.querySelector(`label[for="${cssEscape(id)}"]`)
    const labelText = normalizeFieldText(forLabel?.textContent || '')
    if (labelText) return labelText
  }

  const wrapping = input.closest?.('label')
  const wrappingText = normalizeFieldText(wrapping?.textContent || '')
  if (wrappingText) return wrappingText

  const siblingCandidates = Array.from(input.parentElement?.children || [])
    .filter((node) => node && node !== input)
    .map((node) => normalizeFieldText(node.textContent || ''))
    .filter((text) => isMeaningfulFieldText(text))
  const siblingText = selectBestFieldTextCandidate(siblingCandidates)
  if (siblingText) return siblingText

  return ''
}
