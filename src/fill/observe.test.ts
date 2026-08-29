import { describe, expect, it } from 'vitest'

import { observeField, observeFields, readFieldValuePreview } from './observe'
import type { FieldDescriptor, FieldRuntime } from './types'

function descriptor(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    fieldId: 'f_1',
    kind: 'text',
    label: '姓名',
    name: '',
    id: '',
    placeholder: '',
    options: [],
    required: false,
    context: '',
    sectionKey: '',
    sectionLabel: '',
    sectionEvidence: '',
    nearbyLabels: [],
    ...overrides,
  }
}

function selectRuntime(selectedIndex: number, labels: string[]): FieldRuntime {
  return {
    fieldId: 'f_1',
    kind: 'select',
    el: {
      selectedIndex,
      options: labels.map((label, index) => ({ textContent: label, value: String(index) })),
      value: String(selectedIndex),
    } as unknown as HTMLSelectElement,
  }
}

describe('readFieldValuePreview', () => {
  it('reads input value for text fields', () => {
    const runtime: FieldRuntime = {
      fieldId: 'f_1',
      kind: 'text',
      el: { value: ' 张三 ' } as unknown as HTMLInputElement,
    }
    expect(readFieldValuePreview(runtime)).toBe('张三')
  })

  it('reads selected option text for select', () => {
    const runtime = selectRuntime(1, ['请选择', '硕士'])
    expect(readFieldValuePreview(runtime)).toBe('硕士')
  })

  it('treats placeholder option (index 0, empty value) as unfilled', () => {
    const runtime: FieldRuntime = {
      fieldId: 'f_1',
      kind: 'select',
      el: {
        selectedIndex: 0,
        value: '',
        options: [{ textContent: '请选择', value: '' }, { textContent: '本科', value: '1' }],
      } as unknown as HTMLSelectElement,
    }
    expect(readFieldValuePreview(runtime)).toBe('')
  })

  it('reads first option when it carries a real value', () => {
    const runtime: FieldRuntime = {
      fieldId: 'f_1',
      kind: 'select',
      el: {
        selectedIndex: 0,
        value: 'male',
        options: [{ textContent: '男', value: 'male' }, { textContent: '女', value: 'female' }],
      } as unknown as HTMLSelectElement,
    }
    expect(readFieldValuePreview(runtime)).toBe('男')
  })

  it('reads checked labels for radio/checkbox groups', () => {
    const runtime: FieldRuntime = {
      fieldId: 'f_1',
      kind: 'checkbox_group',
      options: [
        { el: { checked: true } as HTMLInputElement, label: '英语', value: 'en' },
        { el: { checked: true } as HTMLInputElement, label: '法语', value: 'fr' },
        { el: { checked: false } as HTMLInputElement, label: '德语', value: 'de' },
      ],
    }
    expect(readFieldValuePreview(runtime)).toBe('英语, 法语')
  })

  it('reads textContent for contenteditable', () => {
    const runtime: FieldRuntime = {
      fieldId: 'f_1',
      kind: 'contenteditable',
      el: { textContent: '自我介绍' } as unknown as HTMLElement,
    }
    expect(readFieldValuePreview(runtime)).toBe('自我介绍')
  })

  it('reads display value for custom_select and treats placeholder as empty', () => {
    const selected: FieldRuntime = {
      fieldId: 'f_1',
      kind: 'custom_select',
      el: { tagName: 'DIV', textContent: '硕士研究生' } as unknown as HTMLElement,
    }
    expect(readFieldValuePreview(selected)).toBe('硕士研究生')

    const placeholder: FieldRuntime = {
      fieldId: 'f_2',
      kind: 'custom_select',
      el: { tagName: 'DIV', textContent: '请选择' } as unknown as HTMLElement,
    }
    expect(readFieldValuePreview(placeholder)).toBe('')
  })

  it('returns empty for file fields and missing runtime', () => {
    expect(readFieldValuePreview({ fieldId: 'f', kind: 'file' })).toBe('')
    expect(readFieldValuePreview(undefined)).toBe('')
  })
})

describe('observeField', () => {
  it('snapshots current value and hasValue flag', () => {
    const observation = observeField(descriptor(), {
      fieldId: 'f_1',
      kind: 'text',
      el: { value: 'zhang@example.com' } as unknown as HTMLInputElement,
    })

    expect(observation.currentValue).toBe('zhang@example.com')
    expect(observation.hasValue).toBe(true)
    expect(observation.descriptor.fieldId).toBe('f_1')
  })

  it('truncates long previews', () => {
    const longValue = 'a'.repeat(100)
    const observation = observeField(descriptor(), {
      fieldId: 'f_1',
      kind: 'text',
      el: { value: longValue } as unknown as HTMLInputElement,
    })
    expect(observation.currentValue.endsWith('...')).toBe(true)
    expect(observation.currentValue.length).toBeLessThanOrEqual(43)
  })

  it('empty field has no value', () => {
    const observation = observeField(descriptor(), {
      fieldId: 'f_1',
      kind: 'text',
      el: { value: '' } as unknown as HTMLInputElement,
    })
    expect(observation.hasValue).toBe(false)
    expect(observation.currentValue).toBe('')
  })
})

describe('observeFields', () => {
  it('pairs descriptors with runtimes by fieldId', () => {
    const fields = [descriptor({ fieldId: 'f_1' }), descriptor({ fieldId: 'f_2', label: '邮箱' })]
    const runtimeMap = new Map<string, FieldRuntime>([
      ['f_2', { fieldId: 'f_2', kind: 'text', el: { value: 'a@b.c' } as unknown as HTMLInputElement }],
    ])

    const observations = observeFields(fields, runtimeMap)
    expect(observations).toHaveLength(2)
    expect(observations[0].runtime).toBeUndefined()
    expect(observations[0].hasValue).toBe(false)
    expect(observations[1].currentValue).toBe('a@b.c')
  })
})
