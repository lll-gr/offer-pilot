/**
 * chrome.tabs 辅助：活动标签页查询与消息发送（UI 层唯一入口）。
 */

export interface ActiveTab {
  id: number | null
  url: string
  title: string
}

export function isSupportedWebPageUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export async function getActiveTab(): Promise<ActiveTab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab) return null
  return { id: tab.id ?? null, url: tab.url || '', title: tab.title || '' }
}

export function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response)
    })
  })
}

export async function openResumeEditorPage(): Promise<void> {
  const url = chrome.runtime.getURL('resume-editor.html')
  await chrome.tabs.create({ url })
}
