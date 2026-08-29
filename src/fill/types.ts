/**
 * 填表领域类型：观察 / 规划 / 执行三层模型。
 * 扫描产出 descriptor；observe 附着当前值快照；plan 产出五动作决策；
 * execute 消费决策产出结果。新增控件类型时扩展 FieldKind，
 * 并在 execute/strategies.ts 注册策略、observe.ts 补当前值读取分支。
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'custom_select'
  | 'contenteditable'
  | 'file'
  | 'radio_group'
  | 'checkbox_group'

/** 扫描产物（纯数据，可序列化；缓存签名与 AI 载荷的数据源） */
export interface FieldDescriptor {
  fieldId: string
  kind: FieldKind
  label: string
  name: string
  id: string
  placeholder: string
  inputType?: string
  /** autocomplete 属性（英文 ATS 确定性规则的原料；中文站常见为空） */
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

/**
 * 五动作：fill 填入 / keep 保留现有值 / correct 修正不符的现有值 /
 * manual 交人工 / skip 无关或无值跳过。
 */
export type FieldAction = 'fill' | 'keep' | 'correct' | 'manual' | 'skip'

/** 决策置信度：high=档案有确切对应 / medium=等价或推理得出 / low=线索不足 */
export type FieldConfidence = 'high' | 'medium' | 'low'

/**
 * 规划产物：单字段唯一决策载体（AI 产出、缓存重放、纠错写回共用）。
 * 执行层不再自行判断跳过/覆盖——一切执行意图都由 action 表达。
 */
export interface FieldDecision {
  fieldId: string
  action: FieldAction
  resumePath: string
  reason: string
  transform: Transform
  /** 置信度：本地防线把 low 的 fill/correct 降级为 manual（AI 拿不准就交人工） */
  confidence?: FieldConfidence
  /**
   * 字段指纹（缓存重放对齐用）：label+name+id+kind+options 的稳定组合。
   * 缓存条目跨扫描重放时按指纹匹配当前字段，不依赖扫描序号（fieldId 每次可能不同）。
   */
  fieldKey?: string
}

export type FillPlan = FieldDecision[]

/** 观察层产物：descriptor + DOM 当前值快照 + 运行时句柄 */
export interface FieldObservation {
  descriptor: FieldDescriptor
  runtime: FieldRuntime | undefined
  /** 当前值预览（keep/correct 决策依据；select/radio 为选中项文本，checkbox 为已勾选项） */
  currentValue: string
  hasValue: boolean
}

export type FieldOutcomeKind = 'filled' | 'kept' | 'manual' | 'skipped' | 'failed'

/** 执行结果：outcome 表动作结果，verified 表填后是否读回验证 */
export interface FieldOutcome {
  fieldId: string
  outcome: FieldOutcomeKind
  verified: boolean
  message?: string
  runtime?: FieldRuntime
}

export interface FillResult {
  filled: boolean
  message?: string
  /** 填了且读回验证过（写入校验 / 填后验证） */
  verified?: boolean
}

export type FillMode = 'overwrite' | 'incremental' | 'segmented'
export type FillScope = 'page' | 'selection'
