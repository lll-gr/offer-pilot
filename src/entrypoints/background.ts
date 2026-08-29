import { defineBackground } from 'wxt/utils/define-background'

import { callAI } from '@/ai/proxy'
import type { CallAiResponse } from '@/messaging/bridge'
import { isCallAiRequest } from '@/messaging/bridge'

export default defineBackground(() => {
  // 顶层调用：service worker 冷启动（浏览器重启）后依然生效
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

  chrome.runtime.onMessage.addListener((request: unknown, sender, sendResponse: (response: CallAiResponse) => void) => {
    if (isCallAiRequest(request)) {
      if (sender?.id && sender.id !== chrome.runtime.id) return

      const { modelId, prompt, mode } = request
      callAI(modelId, prompt, mode)
        .then((response) => sendResponse({ success: true, data: response }))
        .catch((error: Error) => sendResponse({ success: false, error: error?.message || String(error) }))

      return true // 保持消息通道用于异步响应
    }

    // FillEvent 通知（log/stats/phase/fieldProgress）：content → 侧栏的 UI 遥测事件，
    // background 无需处理，忽略即可（契约见 messaging/events.ts）
    return
  })
})
