/**
 * 侧边栏日志渲染过滤：结构化诊断行（扫描/映射/取值/跳过…）信息密度低，
 * 只写入导出文件；用户可见日志保留失败与流程级消息。
 */

function compactText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isVerboseStructuredDiagnostic(message: string): boolean {
  const text = compactText(message)
  return (
    text.startsWith('[扫描]') ||
    text.startsWith('[缓存]') ||
    text.startsWith('[映射:') ||
    text.startsWith('[取值]') ||
    text.startsWith('[跳过]') ||
    text.startsWith('[日期]') ||
    text.startsWith('[填充:成功]')
  )
}

export function shouldRenderLogInUi(level: string, message: string): boolean {
  const text = compactText(message)
  if (!text) return false
  if (text.startsWith('[填充:失败]')) return true
  if (isVerboseStructuredDiagnostic(text)) return false
  return true
}
