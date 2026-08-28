/**
 * 页面/面板侧的 AI 调用客户端：经 background service worker 代理 HTTP，
 * 避免扩展页面的 CORS 限制。协议见 messaging/bridge.ts。
 */

import type { CallAiRequest, CallAiResponse } from '@/messaging/bridge'

export function callAI(modelId: string, prompt: string, mode: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request: CallAiRequest = { action: 'callAI', modelId, prompt, mode }

    chrome.runtime.sendMessage(request, (response: CallAiResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }

      if (!response) {
        reject(new Error('AI 响应为空'))
        return
      }

      if (response.success) {
        resolve(response.data ?? '')
        return
      }

      reject(new Error(response.error || 'AI 调用失败'))
    })
  })
}
