import { describe, expect, it } from 'vitest'

import type { OptionRuntime } from '../types'
import {
  FillVerificationError,
  assertVerified,
  verifyCheckboxState,
  verifyRadioChecked,
  verifySelectSelected,
} from './verify'

function fakeSelect(labels: string[], selectedIndex: number): { options: Array<{ textContent: string; value: string }>; selectedIndex: number } {
  return {
    options: labels.map((label, index) => ({ textContent: label, value: String(index) })),
    selectedIndex,
  }
}

function radioOption(label: string, checked: boolean): OptionRuntime {
  return { el: { checked } as HTMLInputElement, label, value: label }
}

describe('verifySelectSelected', () => {
  it('passes when selected option matches desired', () => {
    const select = fakeSelect(['请选择', '本科', '硕士'], 2)
    expect(verifySelectSelected(select, '硕士')).toEqual({ ok: true, expected: '硕士', actual: '硕士' })
  })

  it('passes via alias equivalence', () => {
    const select = fakeSelect(['请选择', '本科', '硕士研究生'], 2)
    expect(verifySelectSelected(select, '硕士')?.ok).toBe(true)
  })

  it('fails with expected vs actual when framework reset value', () => {
    const select = fakeSelect(['请选择', '本科', '硕士'], 0)
    const outcome = verifySelectSelected(select, '硕士')
    expect(outcome).toEqual({ ok: false, expected: '硕士', actual: '请选择' })
  })

  it('reports 未选择 when nothing selected', () => {
    const select = fakeSelect(['本科', '硕士'], -1)
    expect(verifySelectSelected(select, '硕士')?.actual).toBe('未选择')
  })

  it('returns null when no option matches desired', () => {
    const select = fakeSelect(['本科', '硕士'], 0)
    expect(verifySelectSelected(select, '博士')).toBeNull()
  })

  it('returns null for missing element', () => {
    expect(verifySelectSelected(undefined, '本科')).toBeNull()
    expect(verifySelectSelected({ options: [], selectedIndex: -1 }, '本科')).toBeNull()
  })
})

describe('verifyRadioChecked', () => {
  it('passes when expected radio is checked', () => {
    const options = [radioOption('男', false), radioOption('女', true)]
    expect(verifyRadioChecked(options, 'female')?.ok).toBe(true)
  })

  it('fails when another radio is checked instead', () => {
    const options = [radioOption('男', true), radioOption('女', false)]
    expect(verifyRadioChecked(options, '女')).toEqual({ ok: false, expected: '女', actual: '男' })
  })

  it('reports 未选中 when nothing checked', () => {
    const options = [radioOption('男', false), radioOption('女', false)]
    expect(verifyRadioChecked(options, '女')?.actual).toBe('未选中')
  })

  it('returns null when no option matches', () => {
    expect(verifyRadioChecked([radioOption('男', false)], '女')).toBeNull()
  })
})

describe('verifyCheckboxState', () => {
  it('passes when all wanted options checked', () => {
    const options = [radioOption('英语', true), radioOption('法语', true), radioOption('德语', false)]
    const outcome = verifyCheckboxState(options, ['英语', '法语'])
    expect(outcome?.ok).toBe(true)
  })

  it('fails when a wanted option is unchecked', () => {
    const options = [radioOption('英语', true), radioOption('法语', false)]
    const outcome = verifyCheckboxState(options, ['英语', '法语'])
    expect(outcome).toEqual({ ok: false, expected: '英语、法语', actual: '英语、法语(未勾选)' })
  })

  it('ignores options outside desired set', () => {
    const options = [radioOption('英语', true), radioOption('德语', true)]
    expect(verifyCheckboxState(options, ['英语'])?.ok).toBe(true)
  })

  it('returns null when nothing matches', () => {
    expect(verifyCheckboxState([radioOption('英语', false)], ['法语'])).toBeNull()
    expect(verifyCheckboxState(undefined, ['英语'])).toBeNull()
  })
})

describe('assertVerified', () => {
  it('throws FillVerificationError with expected vs actual message', () => {
    expect(() => assertVerified({ ok: false, expected: '硕士', actual: '请选择' })).toThrow(
      FillVerificationError,
    )
    expect(() => assertVerified({ ok: false, expected: '硕士', actual: '请选择' })).toThrow(
      '期望「硕士」，实际「请选择」',
    )
  })

  it('passes through ok and unverifiable outcomes', () => {
    expect(() => assertVerified({ ok: true, expected: 'x', actual: 'x' })).not.toThrow()
    expect(() => assertVerified(null)).not.toThrow()
  })
})
