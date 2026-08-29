/**
 * 填充策略注册表：FieldKind → FillStrategy 的策略模式。
 * 横切逻辑（取消检查/进度上报/失败重试）以高阶函数装饰器实现，
 * 写一次、包所有策略（切面），不在各策略内部重复。
 */

import type { FieldRuntime, FillResult } from '../types'
import { fillCustomSelect } from './custom-select'
import { fillReadonlyDateRuntime } from './date-panel'
import {
  fillCheckboxGroup,
  fillContentEditable,
  fillRadioGroup,
  fillSelect,
  fillTextLike,
} from './dom'
import { buildTextFallbackValues, hasExistingFieldValue } from './modes'
import { isReadonlyDateLikeRuntime } from './runtime'
import { assertVerified, verifyCheckboxState, verifyRadioChecked, verifySelectSelected } from './verify'
import { prepareTextValueForRuntime } from './values'

export interface FillContext {
  /** 增量模式下不覆盖已有值 */
  overwrite: boolean
  logger?: (message: string) => void
  /** 取消信号：每次策略执行前检查（由 controller 注入） */
  signal?: AbortSignal
  /** 每个字段填充前上报（进度反馈，由 controller 注入） */
  onFieldStart?: (fieldId: string) => void
}

export type FillStrategy = (
  runtime: FieldRuntime,
  value: string | string[],
  ctx: FillContext
) => Promise<FillResult>

// ---------------------------------------------------------------------------
// 基础策略（每个 FieldKind 一个，只关心自己的控件类型）
// ---------------------------------------------------------------------------

const textStrategy: FillStrategy = (runtime, value, ctx) =>
  fillTextLike(runtime, value, {
    isDateLike: isReadonlyDateLikeRuntime(runtime),
    fillDatePanel: (rt, desired) =>
      fillReadonlyDateRuntime(rt, desired, ctx.logger ? { log: ctx.logger } : undefined),
    buildFallbackValues: buildTextFallbackValues,
  })

const textareaStrategy: FillStrategy = textStrategy

const selectStrategy: FillStrategy = async (runtime, value) => {
  const result = await fillSelect(runtime, value)
  assertVerified(verifySelectSelected(runtime.el as HTMLSelectElement, value))
  return { ...result, verified: true }
}

/** 自定义下拉（Ant/Element/Arco）：填后验证在 fillCustomSelect 内部完成，失败抛错走 withRetry */
const customSelectStrategy: FillStrategy = (runtime, value, ctx) =>
  fillCustomSelect(runtime, value, ctx.logger)

const contenteditableStrategy: FillStrategy = async (runtime, value) => {
  const result = await fillContentEditable(runtime, value)
  if (!result.filled) return result
  const desired = prepareTextValueForRuntime(runtime, value)
  const actual = String((runtime.el as HTMLElement)?.textContent ?? '').trim()
  return { ...result, verified: desired !== '' && actual === desired }
}

const radioGroupStrategy: FillStrategy = async (runtime, value) => {
  const result = await fillRadioGroup(runtime, value)
  assertVerified(verifyRadioChecked(runtime.options, value))
  return { ...result, verified: true }
}

const checkboxGroupStrategy: FillStrategy = async (runtime, value, ctx) => {
  const desired = Array.isArray(value) ? value : [value]
  if (!ctx.overwrite) {
    // 增量模式：仅在尚无任何勾选时写入
    if (hasExistingFieldValue(runtime)) {
      return { filled: false, message: '字段已有内容，增量模式下不覆盖' }
    }
  }
  const result = await fillCheckboxGroup(runtime, desired)
  assertVerified(verifyCheckboxState(runtime.options, desired))
  return { ...result, verified: true }
}

const fileStrategy: FillStrategy = async () => ({
  filled: false,
  message: '文件上传字段无法自动填写',
})

// ---------------------------------------------------------------------------
// 切面装饰器（高阶函数）：横切逻辑各写一份，可独立单测
// ---------------------------------------------------------------------------

/** 取消检查：aborted 时短路不执行 */
const withCancelCheck =
  (strategy: FillStrategy): FillStrategy =>
  async (runtime, value, ctx) => {
    if (ctx.signal?.aborted) {
      return { filled: false, message: '已被用户取消' }
    }
    return strategy(runtime, value, ctx)
  }

/** 进度上报：每个字段填充开始前回调 */
const withProgress =
  (strategy: FillStrategy): FillStrategy =>
  async (runtime, value, ctx) => {
    ctx.onFieldStart?.(runtime.fieldId)
    return strategy(runtime, value, ctx)
  }

/**
 * 失败重试：异常时再试一次（日期面板等瞬态弹层失败常见）。
 *
 * 注意：radio/checkbox 策略内部是「点击」语义（非幂等）——若异常发生在点击之后
 * （如等待面板稳定失败），重试会二次点击。当前实现可接受（safeCheck 按目标态勾选，
 * 重复点击同一 radio 无副作用；checkbox 以期望值收敛），新增策略时若含不可重复
 * 副作用（如触发文件选择器），请在策略内部自行保证幂等或不套此装饰器。
 */
const withRetry =
  (strategy: FillStrategy): FillStrategy =>
  async (runtime, value, ctx) => {
    try {
      return await strategy(runtime, value, ctx)
    } catch (error) {
      const firstMessage = (error as Error)?.message || String(error)
      try {
        const result = await strategy(runtime, value, ctx)
        ctx.logger?.(`字段 ${runtime.fieldId} 首次填充异常（${firstMessage}），重试成功`)
        return result
      } catch (secondError) {
        return { filled: false, message: `填充失败：${(secondError as Error)?.message || firstMessage}` }
      }
    }
  }

/** 组合装饰器（导出供测试与未来扩展自定义链） */
export const enhance = (strategy: FillStrategy): FillStrategy =>
  withCancelCheck(withProgress(withRetry(strategy)))

// ---------------------------------------------------------------------------
// 注册表：新增控件类型 = 此处加一行注册，分发逻辑零改动
// ---------------------------------------------------------------------------

export const FILL_STRATEGIES: Record<FieldRuntime['kind'], FillStrategy> = {
  text: enhance(textStrategy),
  textarea: enhance(textareaStrategy),
  select: enhance(selectStrategy),
  custom_select: enhance(customSelectStrategy),
  contenteditable: enhance(contenteditableStrategy),
  radio_group: enhance(radioGroupStrategy),
  checkbox_group: enhance(checkboxGroupStrategy),
  file: enhance(fileStrategy),
}

/** 统一填充入口：注册表查找分发 */
export async function fillOne(
  runtime: FieldRuntime | undefined,
  value: string | string[],
  ctx: FillContext = { overwrite: true }
): Promise<FillResult> {
  if (!runtime) return { filled: false, message: '字段不存在' }
  return FILL_STRATEGIES[runtime.kind](runtime, value, ctx)
}
