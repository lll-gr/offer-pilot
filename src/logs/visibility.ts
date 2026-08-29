/**
 * 侧边栏日志渲染过滤：结构化诊断行（扫描/映射/取值/跳过…）信息密度低，
 * 只写入导出文件；用户可见日志保留失败与流程级消息。
 * 前缀清单集中一处——diagnostics.ts 的行前缀改动时同步这里。
 */

/** 低信息密度前缀（仅导出文件可见） */
const VERBOSE_PREFIXES = ['[扫描]', '[缓存]', '[映射:', '[取值]', '[跳过]', '[日期]', '[填充:成功]'] as const

/** 用户必须看到的前缀（填充失败与验证失败含期望/实际对比） */
const USER_FACING_PREFIXES = ['[填充:失败]'] as const

function compactText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasAnyPrefix(text: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => text.startsWith(prefix))
}

export function isVerboseStructuredDiagnostic(message: string): boolean {
  return hasAnyPrefix(compactText(message), VERBOSE_PREFIXES)
}

export function shouldRenderLogInUi(level: string, message: string): boolean {
  const text = compactText(message)
  if (!text) return false
  if (hasAnyPrefix(text, USER_FACING_PREFIXES)) return true
  return !isVerboseStructuredDiagnostic(text)
}
