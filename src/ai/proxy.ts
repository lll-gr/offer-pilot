/**
 * Background 侧的 AI 代理（业务包装）：system prompt 注入、JSON mode、
 * 429/5xx 退避重试、不支持 JSON mode 的接口自动降级。
 * HTTP 请求核心（URL/超时/错误翻译）复用 ./chat.ts。
 */

import { getModelConfig } from '@/models/storage'

import { getSystemPrompt } from './prompts'
import {
  buildApiUrl,
  buildChatHeaders,
  createApiError,
  postChatCompletion,
} from './chat'
import type { ChatMessage, ChatRequestBody, FetchLike, ResponseLike } from './chat'

const RETRY_DELAY_MS = 1500
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

export interface CallAiDeps {
  fetch?: FetchLike
  getModelConfig?: typeof getModelConfig
  sleep?: (ms: number) => Promise<void>
  logError?: (message: string, detail: string) => void
  /** 请求超时（应用设置注入，缺省走 chat.ts 默认 120s） */
  requestTimeoutMs?: number
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function callAI(
  modelId: string,
  prompt: string,
  mode: string,
  deps: CallAiDeps & { signal?: AbortSignal } = {}
): Promise<string> {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const getConfig = deps.getModelConfig ?? getModelConfig
  const sleep = deps.sleep ?? defaultSleep
  const logError = deps.logError ?? ((message, detail) => console.error(message, detail))
  const externalSignal = deps.signal

  if (externalSignal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const config = await getConfig(modelId)
  if (!config?.baseUrl || !config?.apiKey || !config?.model) {
    throw new Error('模型配置不完整：请检查 Base URL / API Key / 模型ID')
  }

  const url = buildApiUrl(config.baseUrl)
  const normalizedModel = String(config.model).trim()
  const system = getSystemPrompt(mode)

  const headers = buildChatHeaders(config.apiKey)
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

  let response = await postChatCompletion(fetchImpl, url, headers, body, externalSignal, deps.requestTimeoutMs)

  // 部分兼容接口不支持 JSON mode；识别后去掉该参数重试一次。
  if (response.status === 400) {
    const errorText = await response.text()
    if (/response[_-]?format/i.test(errorText)) {
      body = {
        model: normalizedModel,
        temperature: 0.2,
        messages,
      }
      response = await postChatCompletion(fetchImpl, url, headers, body, externalSignal, deps.requestTimeoutMs)
    } else {
      throw createApiError(response.status, errorText, logError)
    }
  }

  if (RETRYABLE_STATUSES.has(response.status)) {
    await sleep(RETRY_DELAY_MS)
    response = await postChatCompletion(fetchImpl, url, headers, body, externalSignal, deps.requestTimeoutMs)
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

export type { FetchLike, ResponseLike }
