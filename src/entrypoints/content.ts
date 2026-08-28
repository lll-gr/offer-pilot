import { defineContentScript } from 'wxt/utils/define-content-script'

import { getPingInfo, getStatus, handleStartFill } from '@/fill/controller'
import type { StartFillRequest } from '@/messaging/bridge'

import '@/fill/page-overlays.css'

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_end',

  main() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const action = (message as { action?: string })?.action

      if (action === 'ping') {
        sendResponse({ success: true, ...getPingInfo() })
        return
      }

      if (action === 'getStatus') {
        sendResponse({ success: true, ...getStatus() })
        return
      }

      if (action === 'startFill') {
        const request = message as StartFillRequest
        handleStartFill(request.modelId, request.resumeProfile, {
          fillMode: request.fillMode,
          scope: request.scope,
        })
          .then((result) => sendResponse(result))
          .catch((error: Error) => sendResponse({ success: false, message: error?.message || String(error) }))
        return true // 保持通道用于异步响应
      }

      return
    })
  },
})
