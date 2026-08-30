/**
 * 规则规划环：autocomplete/name/id/label 的确定性映射（责任链第一环，advance-deciders 同构）。
 * 英文 ATS（Workday/Greenhouse/Lever）的 autocomplete 极规范；中文表单靠 label 精确匹配
 * （清洗后全等，不做子串——「紧急联系人姓名」含「姓名」但不得映射 fullName）。
 * 命中即零 token 零延迟零幻觉；只在档案对应字段有值且（选项类）选项可匹配时才给决策，
 * 拿不准一律返回给 AI 环。
 */

import type { CatalogField } from '@/resume/schema'
import { getCatalogWithValues } from '@/resume/schema'
import { matchesAnyCandidate } from '../execute/match'
import type { FieldDescriptor, FieldDecision, FieldKind } from '../types'

/** autocomplete token → 档案 path（HTML 规范 + ATS 常见私有 token） */
const AUTOCOMPLETE_RULES: Array<{ tokens: string[]; path: string }> = [
  { tokens: ['given-name', 'firstname', 'first-name', 'fname'], path: 'personal.firstName' },
  { tokens: ['family-name', 'lastname', 'last-name', 'lname', 'surname'], path: 'personal.lastName' },
  { tokens: ['name', 'fullname', 'full-name'], path: 'personal.fullName' },
  { tokens: ['email', 'email-address'], path: 'personal.email' },
  { tokens: ['tel', 'tel-national', 'phone', 'mobile'], path: 'personal.phoneNumber' },
  { tokens: ['tel-country-code'], path: 'personal.phoneCountryCode' },
  { tokens: ['bday'], path: 'personal.birthDate' },
  { tokens: ['street-address'], path: 'contactAndLocation.currentAddressLine1' },
  { tokens: ['postal-code', 'zip'], path: 'contactAndLocation.postalCode' },
  { tokens: ['country', 'country-name'], path: 'personal.currentCountry' },
  { tokens: ['organization', 'company'], path: 'workExperiences.0.company' },
  { tokens: ['organization-title', 'job-title', 'title'], path: 'workExperiences.0.position' },
]

/** name/id 属性的精确词面命中（仅高置信形态：全等或下划线连字符变体） */
const NAME_RULES: Array<{ keys: string[]; path: string }> = [
  { keys: ['email'], path: 'personal.email' },
  { keys: ['phone', 'mobile', 'phonenumber'], path: 'personal.phoneNumber' },
  { keys: ['firstname'], path: 'personal.firstName' },
  { keys: ['lastname'], path: 'personal.lastName' },
  { keys: ['fullname'], path: 'personal.fullName' },
  { keys: ['wechat'], path: 'personal.wechatId' },
]

const TEXT_LIKE_KINDS: FieldKind[] = ['text', 'textarea', 'custom_select']

/**
 * label 精确匹配表：仅收录无歧义的单值 personal 字段。
 * 学历/学校/专业等列表段字段（多槽位歧义）不进规则环，留给 AI 综合判断。
 */
const LABEL_RULES: Array<{ keys: string[]; path: string; kinds?: FieldKind[] }> = [
  { keys: ['姓名', '名字', 'fullname', 'name'], path: 'personal.fullName' },
  { keys: ['邮箱', '电子邮件', 'email', 'emailaddress'], path: 'personal.email' },
  {
    keys: ['手机', '手机号', '手机号码', '电话', '联系电话', '电话号码', 'phone', 'mobile', 'tel'],
    path: 'personal.phoneNumber',
  },
  { keys: ['微信号', '微信', 'wechat', 'wechatid'], path: 'personal.wechatId' },
  {
    keys: ['性别', 'gender', 'sex'],
    path: 'personal.gender',
    kinds: ['text', 'select', 'radio_group', 'custom_select'],
  },
]

function normalizeToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/** label 清洗：去必填星号/冒号尾缀、去「请输入/您的」类前缀，再压平分隔符 */
function normalizeLabelText(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[*＊]+/g, '')
    .replace(/[：:]+$/g, '')
    .replace(/^(请输入|请填写|请选择|您的|我的)/g, '')
    .replace(/[-_]/g, '')
}

function resolveAutocomplete(autocomplete: string, catalogByPath: Map<string, CatalogField>): string {
  const tokens = normalizeToken(autocomplete)
    .split(/\s+/)
    .filter(Boolean)

  for (const token of tokens) {
    const rule = AUTOCOMPLETE_RULES.find((item) => item.tokens.includes(token))
    if (rule && catalogByPath.has(rule.path)) return rule.path
  }
  return ''
}

function resolveNameOrId(name: string, id: string, catalogByPath: Map<string, CatalogField>): string {
  for (const raw of [name, id]) {
    const key = normalizeToken(raw).replace(/[-_]/g, '')
    if (!key) continue

    const rule = NAME_RULES.find((item) => item.keys.includes(key))
    if (rule && catalogByPath.has(rule.path)) return rule.path
  }
  return ''
}

function resolveLabel(
  label: string,
  kind: string,
  catalogByPath: Map<string, CatalogField>
): string {
  const key = normalizeLabelText(label)
  if (!key) return ''

  const rule = LABEL_RULES.find((item) => item.keys.includes(key))
  if (!rule) return ''
  const allowedKinds = rule.kinds || TEXT_LIKE_KINDS
  if (!allowedKinds.includes(kind as FieldKind)) return ''
  if (!catalogByPath.has(rule.path)) return ''
  return rule.path
}

function isKindAllowedByLabelRule(kind: string): boolean {
  return LABEL_RULES.some((rule) => (rule.kinds || TEXT_LIKE_KINDS).includes(kind as FieldKind))
}

export interface RulePlannerResult<T = FieldObservationLike> {
  /** 规则命中的决策（已带 high 置信度） */
  decisions: FieldDecision[]
  /** 未命中的 observations（交给 AI 环） */
  remaining: T[]
}

export interface FieldObservationLike {
  descriptor: FieldDescriptor
  currentValue: string
  hasValue: boolean
}

/**
 * 泛型保持 observation 具体类型（FieldObservation 等）透传：
 * remaining 与输入同类型，调用方可直接交给 AI 环。
 */
export function planByRules<T extends FieldObservationLike>(
  observations: T[],
  resumeProfile: Record<string, unknown>,
  catalog: CatalogField[] = getCatalogWithValues(resumeProfile as Parameters<typeof getCatalogWithValues>[0])
): RulePlannerResult<T> {
  const catalogByPath = new Map(catalog.map((field) => [field.path, field]))

  const decisions: FieldDecision[] = []
  const remaining: T[] = []

  for (const observation of observations) {
    const descriptor = observation.descriptor
    const isTextLike = TEXT_LIKE_KINDS.includes(descriptor.kind as FieldKind)
    const labelEligible = isKindAllowedByLabelRule(descriptor.kind)

    // 非规则适用类型（非 text 族且无 label 规则收录）：直接交给 AI 环
    if (!isTextLike && !labelEligible) {
      remaining.push(observation)
      continue
    }

    // autocomplete/name 语义只对 text 族生效（与历史行为一致）；
    // 选项类控件仅经 label 规则白名单（如 性别）进入
    const matchedPath =
      (isTextLike
        ? resolveAutocomplete(descriptor.autocomplete || '', catalogByPath) ||
          resolveNameOrId(descriptor.name, descriptor.id, catalogByPath)
        : '') || resolveLabel(descriptor.label, descriptor.kind, catalogByPath)

    if (!matchedPath) {
      remaining.push(observation)
      continue
    }

    const catalogField = catalogByPath.get(matchedPath)
    if (!catalogField?.hasValue) {
      // 档案无值：规则命中也不产出决策（fill 空值无意义），交给 AI 综合判断
      remaining.push(observation)
      continue
    }

    // 选项类控件（select/radio/checkbox 组）：档案值必须能匹配到现有选项才算「确定」
    if (descriptor.options?.length && descriptor.kind !== 'custom_select') {
      if (!matchesAnyCandidate(String(catalogField.value ?? ''), descriptor.options)) {
        remaining.push(observation)
        continue
      }
    }

    decisions.push({
      fieldId: descriptor.fieldId,
      action: observation.hasValue ? 'correct' : 'fill',
      resumePath: matchedPath,
      reason: `规则命中：${descriptor.autocomplete ? `autocomplete=${descriptor.autocomplete}` : descriptor.label ? `label=${descriptor.label}` : `name/id=${descriptor.name || descriptor.id}`}`,
      transform: { type: 'none' },
      confidence: 'high',
    })
  }

  return { decisions, remaining }
}
