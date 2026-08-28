/**
 * Background 侧的 AI 代理：组装请求、JSON mode、429/5xx 退避重试、
 * 不支持 JSON mode 的接口自动降级。fetch 通过 deps 注入以便测试。
 */

import { getModelConfig } from '@/models/storage'

import { getSystemPrompt } from './prompts'

const REQUEST_TIMEOUT_MS = 120_000
const RETRY_DELAY_MS = 1500
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

interface ChatRequestBody {
  model: string
  temperature: number
  response_format?: { type: 'json_object' }
  messages: ChatMessage[]
}

interface FetchLike {
  (url: string, init: RequestInit): Promise<ResponseLike>
}

export interface ResponseLike {
  ok: boolean
  status: number
  text(): Promise<string>
  json(): Promise<unknown>
}

export interface CallAiDeps {
  fetch?: FetchLike
  getModelConfig?: typeof getModelConfig
  sleep?: (ms: number) => Promise<void>
  logError?: (message: string, detail: string) => void
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function callAI(
  modelId: string,
  prompt: string,
  mode: string,
  deps: CallAiDeps = {}
): Promise<string> {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const getConfig = deps.getModelConfig ?? getModelConfig
  const sleep = deps.sleep ?? defaultSleep
  const logError = deps.logError ?? ((message, detail) => console.error(message, detail))

  const config = await getConfig(modelId)
  if (!config?.baseUrl || !config?.apiKey || !config?.model) {
    throw new Error('模型配置不完整：请检查 Base URL / API Key / 模型ID')
  }

  const url = buildApiUrl(config.baseUrl)
  const normalizedModel = String(config.model).trim()
  const system = getSystemPrompt(mode)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: String(prompt || '') },
  ]

  let body: ChatRequestBody = {
    model: normalizedModel,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages,
  }

  let response = await postChatCompletion(fetchImpl, url, headers, body)

  // 部分兼容接口不支持 JSON mode；识别后去掉该参数重试一次。
  if (response.status === 400) {
    const errorText = await response.text()
    if (/response[_-]?format/i.test(errorText)) {
      body = {
        model: normalizedModel,
        temperature: 0.2,
        messages,
      }
      response = await postChatCompletion(fetchImpl, url, headers, body)
    } else {
      throw createApiError(response.status, errorText, logError)
    }
  }

  if (RETRYABLE_STATUSES.has(response.status)) {
    await sleep(RETRY_DELAY_MS)
    response = await postChatCompletion(fetchImpl, url, headers, body)
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw createApiError(response.status, errorText, logError)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('API 返回不是有效 JSON')
  }

  const content = (data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('API 返回格式错误：缺少 choices[0].message.content')
  }
  return content
}

async function postChatCompletion(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: ChatRequestBody
): Promise<ResponseLike> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal as unknown as AbortSignal,
      headers,
      body: JSON.stringify(body),
    })
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error('API 请求超时：请检查网络/Key/模型是否可用后重试')
    }
    throw new Error(`网络请求失败：${(err as Error)?.message || String(err)}`)
  } finally {
    clearTimeout(timeoutId)
  }
}

function createApiError(
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

function redactAndTruncate(value: string, maxLength = 500): string {
  return String(value || '')
    .replace(/(authorization|api[-_ ]?key|token|password|secret)\s*[:=]\s*[^,\s}]+/gi, '$1=[redacted]')
    .slice(0, maxLength)
}
