import { describe, expect, it, vi } from 'vitest'

import { FILL_STRATEGIES, fillOne, enhance } from './strategies'
import type { FillContext } from './strategies'
import type { FieldRuntime } from '../types'

const BASE_CTX: FillContext = { overwrite: true }

describe('FILL_STRATEGIES registry', () => {
  it('registers a strategy for every FieldKind', () => {
    const kinds = ['text', 'textarea', 'select', 'custom_select', 'contenteditable', 'radio_group', 'checkbox_group', 'file']
    for (const kind of kinds) {
      expect(FILL_STRATEGIES[kind as FieldRuntime['kind']]).toBeTypeOf('function')
    }
  })

  it('file strategy always reports unsupported', async () => {
    const result = await fillOne({ fieldId: 'f', kind: 'file' }, 'x', BASE_CTX)
    expect(result.filled).toBe(false)
    expect(result.message).toContain('文件上传')
  })

  it('returns field-missing for undefined runtime', async () => {
    const result = await fillOne(undefined, 'x', BASE_CTX)
    expect(result.filled).toBe(false)
    expect(result.message).toContain('字段不存在')
  })
})

describe('decorators', () => {
  it('withCancelCheck short-circuits when signal aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await fillOne({ fieldId: 'f', kind: 'text', el: {} as HTMLElement }, 'x', {
      ...BASE_CTX,
      signal: controller.signal,
    })

    expect(result.filled).toBe(false)
    expect(result.message).toContain('取消')
  })

  it('withProgress reports field start before filling', async () => {
    const onFieldStart = vi.fn()
    // select 策略走 fillSelect；mock 掉 dom 模块最重，这里用 file 策略验证装饰器层
    await fillOne({ fieldId: 'f_file', kind: 'file' }, 'x', { ...BASE_CTX, onFieldStart })

    expect(onFieldStart).toHaveBeenCalledWith('f_file')
  })

  it('withRetry retries once on strategy throw and returns final error', async () => {
    let calls = 0
    const throwing: import('./strategies').FillStrategy = async () => {
      calls += 1
      throw new Error('面板瞬态失败')
    }

    const result = await enhance(throwing)({ fieldId: 'f', kind: 'contenteditable' }, 'x', BASE_CTX)

    expect(calls).toBe(2) // 重试了一次
    expect(result.filled).toBe(false)
    expect(result.message).toContain('填充失败')
  })

  it('withRetry succeeds on second attempt without error result', async () => {
    let calls = 0
    const flaky: import('./strategies').FillStrategy = async () => {
      calls += 1
      if (calls === 1) throw new Error('瞬态失败')
      return { filled: true, message: 'ok' }
    }

    const result = await enhance(flaky)({ fieldId: 'f', kind: 'text' }, 'x', BASE_CTX)
    expect(result.filled).toBe(true)
  })
})

/** 模拟 select 元素：value 赋值联动 selectedIndex；resetAfterSet 模拟受控组件回弹 */
function fakeSelectEl(labels: string[], resetAfterSet = false): HTMLSelectElement {
  const options = labels.map((label, index) => ({ textContent: label, value: String(index) }))
  const el = {
    options,
    selectedIndex: 0,
    dispatchEvent: () => true,
  } as unknown as Record<string, unknown> & HTMLSelectElement
  Object.defineProperty(el, 'value', {
    get: () => String(options[(el as { selectedIndex: number }).selectedIndex]?.value ?? ''),
    set: (next: string) => {
      const index = options.findIndex((option) => option.value === next)
      ;(el as { selectedIndex: number }).selectedIndex = resetAfterSet ? 0 : index
    },
  })
  return el as unknown as HTMLSelectElement
}

describe('post-fill verification wiring', () => {
  it('select strategy verifies selected state after fill', async () => {
    const el = fakeSelectEl(['请选择', '本科', '硕士'])
    const result = await fillOne({ fieldId: 'f', kind: 'select', el }, '硕士', BASE_CTX)

    expect(result.filled).toBe(true)
    expect(el.selectedIndex).toBe(2)
  })

  it('select strategy fails with expected-vs-actual when controlled select resets', async () => {
    const el = fakeSelectEl(['请选择', '本科', '硕士'], true)
    const result = await fillOne({ fieldId: 'f', kind: 'select', el }, '硕士', BASE_CTX)

    expect(result.filled).toBe(false)
    expect(result.message).toContain('填后验证失败')
    expect(result.message).toContain('硕士')
    expect(result.message).toContain('请选择')
  })

  it('radio strategy verifies checked state after fill', async () => {
    const el = {
      checked: false,
      click() {
        this.checked = true
      },
      dispatchEvent: () => true,
    } as unknown as HTMLInputElement
    const runtime = {
      fieldId: 'f',
      kind: 'radio_group' as const,
      options: [
        { el: { checked: false, dispatchEvent: () => true } as unknown as HTMLInputElement, label: "男", value: "M" },
        { el, label: '女', value: 'F' },
      ],
    }

    const result = await fillOne(runtime, 'female', BASE_CTX)
    expect(result.filled).toBe(true)
    expect(el.checked).toBe(true)
  })

  it('radio strategy retries then reports verification failure when click never lands', async () => {
    const stubborn = {
      checked: false,
      click() {
        // 受控组件回弹：点击后仍不落选中态
      },
      dispatchEvent: () => true,
    } as unknown as HTMLInputElement
    const runtime = {
      fieldId: 'f',
      kind: 'radio_group' as const,
      options: [
        { el: { checked: true, dispatchEvent: () => true } as unknown as HTMLInputElement, label: "男", value: "M" },
        { el: stubborn, label: '女', value: 'F' },
      ],
    }

    const result = await fillOne(runtime, '女', BASE_CTX)
    expect(result.filled).toBe(false)
    expect(result.message).toContain('填后验证失败')
    expect(result.message).toContain('女')
    expect(result.message).toContain('男')
  })
})
