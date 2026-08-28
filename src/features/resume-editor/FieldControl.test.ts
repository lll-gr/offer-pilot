import { describe, expect, it } from 'vitest'

import { resolveControlProps } from './FieldControl'
import type { ResumeFieldDef } from '@/resume/schema'

function makeField(overrides: Partial<ResumeFieldDef> = {}): ResumeFieldDef {
  return {
    key: 'test',
    label: '测试',
    input: 'text',
    options: [],
    ...overrides,
  }
}

describe('resolveControlProps', () => {
  it('maps textarea input to textarea control', () => {
    expect(resolveControlProps(makeField({ input: 'textarea', placeholder: '描述' }))).toEqual({
      controlType: 'textarea',
      className: 'op-ctrl-textarea',
      inputType: '',
      placeholder: '描述',
    })
  })

  it('maps select input with options', () => {
    expect(resolveControlProps(makeField({ input: 'select', options: ['男', '女'] }))).toEqual({
      controlType: 'select',
      className: 'op-ctrl-select',
      inputType: '',
      placeholder: '',
    })
  })

  it('maps date input to text input with date placeholder', () => {
    expect(resolveControlProps(makeField({ input: 'date' }))).toEqual({
      controlType: 'input',
      className: 'op-ctrl-input',
      inputType: 'text',
      placeholder: 'YYYY-MM 或 YYYY-MM-DD',
    })
  })

  it('keeps email/tel/url input types and falls back to text', () => {
    expect(resolveControlProps(makeField({ input: 'email' })).inputType).toBe('email')
    expect(resolveControlProps(makeField({ input: 'tel' })).inputType).toBe('tel')
    expect(resolveControlProps(makeField({ input: 'url' })).inputType).toBe('url')
    expect(resolveControlProps(makeField({})).inputType).toBe('text')
  })
})
