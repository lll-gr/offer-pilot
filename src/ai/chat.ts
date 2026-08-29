/**
 * OpenAI 兼容 chat/completions 请求核心（可复用）：
 * URL 拼装/校验、超时与取消、错误翻译、脱敏日志。
 * callAI（业务包装：system prompt + JSON mode + 重试）与
 * testModelConnection（连通性探针）共用这一层。
 */

const REQUEST_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 20_000

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface ChatRequestBody {
  model: string
  temperature: number
  response_format?: { type: 'json_object' }
  messages: ChatMessage[]
  max_tokens?: number
}

export interface ChatConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface FetchLike {
  (url: string, init: RequestInit): Promise<ResponseLike>
}

export interface ResponseLike {
  ok: boolean
  status: number
  text(): Promise<string>
  json(): Promise<unknown>
}

export interface ChatDeps {
  fetch?: FetchLike
  logError?: (message: string, detail: string) => void
}

export function buildApiUrl(baseUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(String(baseUrl || '').trim())
  } catch {
    throw new Error('Base URL 不是有效地址')
  }

  const isLocalDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalDevelopmentHost)) {
    throw new Error('Base URL 必须使用 HTTPS（本机开发地址可使用 HTTP）')
  }

  parsed.search = ''
  parsed.hash = ''
  const path = parsed.pathname.replace(/\/+$/, '')
  parsed.pathname = path.endsWith('/chat/completions') ? path : `${path || ''}/chat/completions`
  return parsed.toString().replace(/\/$/, '')
}

export function buildChatHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

export async function postChatCompletion(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: ChatRequestBody,
  externalSignal?: AbortSignal,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<ResponseLike> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  // 外部取消（用户停止填充）与超时共用同一 abort 通道
  const onExternalAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', onExternalAbort)
  try {
    return await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal as unknown as AbortSignal,
      headers,
      body: JSON.stringify(body),
    })
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      // 外部取消（用户停止）原样抛 AbortError，仅超时转友好文案
      if (externalSignal?.aborted) {
        throw err
      }
      throw new Error('API 请求超时：请检查网络/Key/模型是否可用后重试')
    }
    throw new Error(`网络请求失败：${(err as Error)?.message || String(err)}`)
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

export function createApiError(
  status: number,
  errorText: string,
  logError: (message: string, detail: string) => void
): Error {
  let errorMsg = `API 请求失败 (${status})`

  try {
    const errorJson = JSON.parse(errorText) as {
      error?: { message?: string }
      message?: string
    }
    const msg = errorJson?.error?.message || errorJson?.message || ''
    if (status === 401) {
      errorMsg = 'API Key 无效，请检查配置'
    } else if (status === 403) {
      errorMsg = 'API 访问被拒绝，请检查 Key/权限/余额'
    } else if (status === 429) {
      errorMsg = 'API 请求过于频繁，请稍后重试'
    } else if ([500, 502, 503].includes(status)) {
      errorMsg = 'API 服务暂时不可用，请稍后重试'
    } else if (msg) {
      errorMsg = `API 错误：${msg}`
    }
  } catch {
    // ignore
  }

  logError('[offer-pilot] API 请求失败:', redactAndTruncate(errorText))
  return new Error(errorMsg)
}

/**
 * 连通性探针：1 token 上限的最小 chat 请求，验证 baseUrl/key/model 三件套。
 * 不经 storage、不落盘——表单里填什么就测什么。
 */
export async function testModelConnection(
  config: ChatConfig,
  deps: ChatDeps = {}
): Promise<{ ok: true; elapsedMs: number } | { ok: false; error: string }> {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const logError = deps.logError ?? ((message, detail) => console.error(message, detail))
  const startedAt = Date.now()

  try {
    const url = buildApiUrl(config.baseUrl)
    const response = await postChatCompletion(
      fetchImpl,
      url,
      buildChatHeaders(config.apiKey),
      {
        model: String(config.model).trim(),
        temperature: 0,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      },
      undefined,
      PROBE_TIMEOUT_MS
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      return { ok: false, error: createApiError(response.status, errorText, logError).message }
    }

    return { ok: true, elapsedMs: Date.now() - startedAt }
  } catch (error) {
    return { ok: false, error: (error as Error).message || String(error) }
  }
}

function redactAndTruncate(value: string, maxLength = 500): string {
  return String(value || '')
    .replace(/(authorization|api[-_ ]?key|token|password|secret)\s*[:=]\s*[^,\s}]+/gi, '$1=[redacted]')
    .slice(0, maxLength)
}
