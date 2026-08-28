/**
 * schema 驱动的字段控件：由字段定义派生控件类型与属性，
 * 编辑器不写 per-field 分支。
 */

import type { ResumeFieldDef } from '@/resume/schema'

export type FieldControlType = 'textarea' | 'select' | 'input'

export interface FieldControlProps {
  controlType: FieldControlType
  className: string
  inputType: string
  placeholder: string
}

export function resolveControlProps(field: ResumeFieldDef): FieldControlProps {
  const input = field.input || 'text'

  if (input === 'textarea') {
    return {
      controlType: 'textarea',
      className: 'op-ctrl-textarea',
      inputType: '',
      placeholder: field.placeholder || '',
    }
  }

  if (input === 'select') {
    return {
      controlType: 'select',
      className: 'op-ctrl-select',
      inputType: '',
      placeholder: field.placeholder || '',
    }
  }

  return {
    controlType: 'input',
    className: 'op-ctrl-input',
    inputType: input === 'date' ? 'text' : input,
    placeholder: field.placeholder || (input === 'date' ? 'YYYY-MM 或 YYYY-MM-DD' : ''),
  }
}

interface FieldControlComponentProps {
  field: ResumeFieldDef
  path: string
  value: string
  onChange: (path: string, value: string) => void
}

export function FieldControl({ field, path, value, onChange }: FieldControlComponentProps) {
  const props = resolveControlProps(field)

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    onChange(path, event.target.value)
  }

  if (props.controlType === 'textarea') {
    return (
      <textarea
        className={props.className}
        data-resume-path={path}
        placeholder={props.placeholder}
        value={value}
        onChange={handleChange}
      />
    )
  }

  if (props.controlType === 'select') {
    return (
      <select className={props.className} data-resume-path={path} value={value} onChange={handleChange}>
        {(field.options || []).map((optionValue) => (
          <option key={optionValue} value={optionValue}>
            {optionValue || '请选择'}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      className={props.className}
      type={props.inputType || 'text'}
      data-resume-path={path}
      placeholder={props.placeholder}
      value={value}
      onChange={handleChange}
    />
  )
}
