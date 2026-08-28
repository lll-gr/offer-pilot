/**
 * 填表领域类型：字段描述符、运行时句柄、AI 映射结果与转换规则。
 * 新增表单控件类型时在此扩展 FieldKind，并在 filler/modes.ts 补对应分支。
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'contenteditable'
  | 'file'
  | 'radio_group'
  | 'checkbox_group'

/** 发送给 AI 的字段描述（纯数据，可序列化） */
export interface FieldDescriptor {
  fieldId: string
  kind: FieldKind
  label: string
  name: string
  id: string
  placeholder: string
  inputType?: string
  autocomplete?: string
  options: string[]
  required: boolean
  context: string
  sectionKey: string
  sectionLabel: string
  sectionEvidence: string
  nearbyLabels: string[]
}

/** 单选/多选组的选项运行时 */
export interface OptionRuntime {
  el: HTMLInputElement
  label: string
  value: string
}

/**
 * 字段运行时句柄：持有 DOM 引用，不参与序列化。
 * text 类附带上词语义信息用于日期/薪资适配。
 */
export interface FieldRuntime {
  fieldId: string
  kind: FieldKind
  el?: HTMLElement
  inputType?: string
  readOnly?: boolean
  label?: string
  placeholder?: string
  context?: string
  nearbyLabels?: string[]
  hasCalendarIcon?: boolean
  options?: OptionRuntime[]
}

export interface ScanResult {
  fields: FieldDescriptor[]
  runtime: FieldRuntime[]
}

export type Transform =
  | { type: 'none' }
  | { type: 'date_part'; part: 'year' | 'month' | 'day' }
  | { type: 'phone_part'; part: 'countryCode' | 'nationalNumber' }
  | { type: 'boolean_choice'; trueValue: string; falseValue: string }
  | { type: 'join'; separator: string }

/** AI 字段映射结果（已按 schema 目录归一化） */
export interface FieldMapping {
  fieldId: string
  resumePath: string
  reason: string
  transform: Transform
}

export interface FillResult {
  filled: boolean
  message?: string
}

export type FillMode = 'overwrite' | 'incremental' | 'segmented'
export type FillScope = 'page' | 'selection'
