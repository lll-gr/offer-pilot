/**
 * 选项匹配：select 选项、radio/checkbox 候选与简历值的对齐。
 * 含中英文别名组（MATCH_ALIAS_GROUPS）与短数字误配防护。
 */

import { normalizeForMatch } from '@/resume/schema'

import type { OptionRuntime } from '../types'

interface AliasGroup {
  key: string
  values: string[]
}

export const MATCH_ALIAS_GROUPS: AliasGroup[] = [
  {
    key: 'yes',
    values: ['yes', 'y', 'true', '1', '是', '有', '愿意', '可以', 'present', 'current', 'currently'],
  },
  {
    key: 'no',
    values: ['no', 'n', 'false', '0', '否', '无', '不愿意', '不可以', '不需要'],
  },
  { key: 'male', values: ['male', 'man', 'm', '男', '男性'] },
  { key: 'female', values: ['female', 'woman', 'f', '女', '女性'] },
  { key: 'fulltime', values: ['fulltime', 'full-time', '全职'] },
  { key: 'parttime', values: ['parttime', 'part-time', '兼职'] },
  { key: 'internship', values: ['internship', 'intern', '实习'] },
  { key: 'contract', values: ['contract', 'contractor', '合同'] },
  { key: 'freelance', values: ['freelance', '自由职业'] },
  { key: 'bachelor', values: ['bachelor', 'undergraduate', '本科', '学士', '大学本科'] },
  { key: 'highschool', values: ['highschool', 'high-school', '高中'] },
  { key: 'associate', values: ['associate', '大专', '大学专科'] },
  { key: 'master', values: ['master', 'masters', '硕士', '硕士研究生'] },
  { key: 'mba', values: ['mba'] },
  { key: 'phd', values: ['phd', 'doctorate', '博士', '博士研究生', '博士后'] },
  { key: 'single', values: ['single', '未婚'] },
  { key: 'married', values: ['married', '已婚'] },
  { key: 'onsite', values: ['onsite', 'on-site', '现场办公', '到岗办公'] },
  { key: 'hybrid', values: ['hybrid', '混合办公'] },
  { key: 'remote', values: ['remote', '远程办公'] },
  { key: 'flexible', values: ['flexible', '灵活'] },
  { key: 'graduated', values: ['graduated', '已毕业'] },
  { key: 'expected', values: ['expected', '预计毕业'] },
  { key: 'enrolled', values: ['enrolled', '在读'] },
  { key: 'dropped', values: ['dropped', '肄业'] },
  { key: 'idcard', values: ['identitycard', 'idcard', '身份证'] },
  {
    key: 'regularfulltime',
    values: ['regularfulltime', 'fulltimedegree', '统招', '统招全日制', '全日制', '全国普通高等院校全日制'],
  },
  {
    key: 'nonfulltime',
    values: ['nonfulltime', 'parttimedegree', '非统招', '非全日制', '全国普通高等院校非全日制'],
  },
  { key: 'jointtraining', values: ['jointtraining', 'jointprogram', '联合培养'] },
  { key: 'commissionedtraining', values: ['commissionedtraining', '委托培养'] },
  { key: 'passport', values: ['passport', '护照'] },
  { key: 'permit', values: ['residencepermit', 'permit', '居留许可'] },
  { key: 'native', values: ['native', '母语'] },
  { key: 'fluent', values: ['fluent', '流利'] },
  { key: 'professional', values: ['professional', 'business', '工作熟练', '专业'] },
  { key: 'intermediate', values: ['intermediate', '中等', '中级'] },
  { key: 'basic', values: ['basic', '基础', '初级'] },
]

const NUMERIC_UNIT_SUFFIX = /^(?:\d+)(?:届|年|月|日|人|次|个|万|千|元|岁|k|w)$/i

function expandMatchVariants(value: unknown): string[] {
  const text = String(value || '').trim()
  if (!text) return []

  const normalized = normalizeForMatch(text)
  const variants = new Set([normalized])

  for (const group of MATCH_ALIAS_GROUPS) {
    if (group.values.includes(normalized)) {
      group.values.forEach((item) => variants.add(item))
    }
  }

  return Array.from(variants)
}

/**
 * 包含得分：纯数字候选被长选项包含时不可靠（"10" 会命中 "100人以内"），
 * 只有「数字 + 单个单位字符」的形式才按高置信包含处理。
 */
function getContainmentScore(shorter: string, longer: string): number {
  if (!longer.includes(shorter)) return 0

  if (/^\d+$/.test(shorter)) {
    return longer.length - shorter.length === 1 && NUMERIC_UNIT_SUFFIX.test(longer) ? 75 : 50
  }

  return 75
}

export function getMatchScore(optionText: string, candidateText: string): number {
  const optionVariants = expandMatchVariants(optionText)
  const candidateVariants = expandMatchVariants(candidateText)
  let bestScore = 0

  for (const optionVariant of optionVariants) {
    for (const candidateVariant of candidateVariants) {
      if (!optionVariant || !candidateVariant) continue
      if (optionVariant === candidateVariant) return 100

      if (optionVariant.includes(candidateVariant)) {
        bestScore = Math.max(bestScore, getContainmentScore(candidateVariant, optionVariant))
      } else if (candidateVariant.includes(optionVariant)) {
        bestScore = Math.max(bestScore, getContainmentScore(optionVariant, candidateVariant))
      }
    }
  }

  return bestScore
}

export function matchesAnyCandidate(optionText: string, candidates: string[]): boolean {
  return candidates.some((candidate) => getMatchScore(optionText, candidate) >= 60)
}

export function isAffirmative(value: unknown): boolean {
  const normalized = normalizeForMatch(value)
  return MATCH_ALIAS_GROUPS.find((group) => group.key === 'yes')?.values.includes(normalized) ?? false
}

export interface LabeledOption {
  label: string
  value: string
}

/** 在选项中挑最佳匹配：全等 100 优先，否则模糊分 ≥ 60 */
export function pickBestOption<T extends LabeledOption>(options: T[], desired: string | string[]): T | null {
  const candidates = Array.isArray(desired)
    ? desired
    : [desired].filter((item) => item != null && String(item).trim())

  let exact: T | null = null
  let fuzzy: { option: T; score: number } | null = null

  for (const option of options || []) {
    const label = String(option.label || option.value || '').trim()
    if (!label) continue

    for (const candidate of candidates) {
      const score = getMatchScore(label, candidate)
      if (score >= 100) {
        exact = option
        break
      }

      if (!fuzzy || score > fuzzy.score) {
        fuzzy = { option, score }
      }
    }

    if (exact) break
  }

  return exact || (fuzzy && fuzzy.score >= 60 ? fuzzy.option : null)
}

export function pickBestRuntimeOption(options: OptionRuntime[], desired: string | string[]): OptionRuntime | null {
  return pickBestOption(options, desired)
}
