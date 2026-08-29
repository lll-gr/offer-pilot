/**
 * 填后验证原语：读回 DOM 真实状态与期望比对。
 * 写入成功 ≠ 状态落定——受控组件可能在 change 事件后回弹重置，
 * 验证失败以异常上抛，交由 withRetry 装饰器统一重试。
 */

import type { OptionRuntime } from '../types'
import { matchesAnyCandidate, pickBestOption } from './match'

export interface VerifyOutcome {
  ok: boolean
  expected: string
  actual: string
}

/** 验证失败异常：message 携带期望与实际，由 withRetry 捕获重试 */
export class FillVerificationError extends Error {
  constructor(outcome: VerifyOutcome) {
    super(`填后验证失败：期望「${outcome.expected}」，实际「${outcome.actual}」`)
    this.name = 'FillVerificationError'
  }
}

interface SelectLikeElement {
  options?: ArrayLike<{ textContent?: string | null; value?: string }>
  selectedIndex?: number
}

/** select：当前选中项文本应与最佳匹配选项一致 */
export function verifySelectSelected(
  selectEl: SelectLikeElement | null | undefined,
  desired: string | string[]
): VerifyOutcome | null {
  if (!selectEl?.options || selectEl.options.length === 0) return null

  const options = Array.from(selectEl.options)
    .map((option) => ({
      el: option,
      label: String(option.textContent || '').trim(),
      value: String(option.value || ''),
    }))
    .filter((option) => option.label)

  const expected = pickBestOption(options, desired)
  if (!expected) return null

  const selectedIndex = Number(selectEl.selectedIndex ?? -1)
  const actual = String(selectEl.options[selectedIndex]?.textContent || '').trim()
  return { ok: actual === expected.label, expected: expected.label, actual: actual || '未选择' }
}

/** radio：最佳匹配项应处于选中态 */
export function verifyRadioChecked(
  options: OptionRuntime[] | undefined,
  desired: string | string[]
): VerifyOutcome | null {
  const runtimeOptions = options || []
  const expected = pickBestOption(runtimeOptions, desired)
  if (!expected) return null

  if (expected.el?.checked) {
    return { ok: true, expected: expected.label, actual: expected.label }
  }

  const checkedOption = runtimeOptions.find((option) => option.el?.checked)
  return { ok: false, expected: expected.label, actual: checkedOption?.label || '未选中' }
}

/** checkbox：所有与期望匹配的选项都应处于勾选态 */
export function verifyCheckboxState(
  options: OptionRuntime[] | undefined,
  desired: string[]
): VerifyOutcome | null {
  const runtimeOptions = options || []
  const wanted = runtimeOptions.filter((option) =>
    matchesAnyCandidate(option.label || option.value, desired),
  )
  if (wanted.length === 0) return null

  const expected = wanted.map((option) => option.label).join('、')
  if (wanted.every((option) => option.el?.checked)) {
    return { ok: true, expected, actual: expected }
  }

  const actual = wanted
    .map((option) => `${option.label}${option.el?.checked ? '' : '(未勾选)'}`)
    .join('、')
  return { ok: false, expected, actual }
}

/** 验证结果裁决：可验证且不符时抛 FillVerificationError */
export function assertVerified(outcome: VerifyOutcome | null): void {
  if (outcome && !outcome.ok) throw new FillVerificationError(outcome)
}
