/**
 * 规则规划环：autocomplete/name/id 的确定性映射（责任链第一环，advance-deciders 同构）。
 * 英文 ATS（Workday/Greenhouse/Lever）的 autocomplete 极规范，命中即零 token 零延迟零幻觉；
 * 只在档案对应字段有值时才给决策，拿不准返回 null 交给 AI 环。
 */

import type { CatalogField } from '@/resume/schema'
import { getCatalogWithValues } from '@/resume/schema'
import type { FieldDescriptor, FieldDecision } from '../types'

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

function normalizeToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
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

/** 仅自动填充明确语义控件：文本类 + 自定义下拉；radio/checkbox 组无 name 级别规则 */
function isRuleEligibleKind(kind: string): boolean {
  return kind === 'text' || kind === 'textarea' || kind === 'custom_select'
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
    if (!isRuleEligibleKind(descriptor.kind)) {
      remaining.push(observation)
      continue
    }

    const resumePath =
      resolveAutocomplete(descriptor.autocomplete || '', catalogByPath) ||
      resolveNameOrId(descriptor.name, descriptor.id, catalogByPath)

    if (!resumePath) {
      remaining.push(observation)
      continue
    }

    const catalogField = catalogByPath.get(resumePath)
    if (!catalogField?.hasValue) {
      // 档案无值：规则命中也不产出决策（fill 空值无意义），交给 AI 综合判断
      remaining.push(observation)
      continue
    }

    decisions.push({
      fieldId: descriptor.fieldId,
      action: observation.hasValue ? 'correct' : 'fill',
      resumePath,
      reason: `规则命中：${descriptor.autocomplete ? `autocomplete=${descriptor.autocomplete}` : `name/id=${descriptor.name || descriptor.id}`}`,
      transform: { type: 'none' },
      confidence: 'high',
    })
  }

  return { decisions, remaining }
}
