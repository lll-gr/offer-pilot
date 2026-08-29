/**
 * 更新检测：GitHub latest release 版本比对（仅检测与提示，不自动安装——
 * 开发者模式扩展的代码替换必须用户手动完成，这是平台安全边界）。
 * 24 小时节流，失败静默（检测是锦上添花，不能打扰主流程）。
 */

import { useCallback, useEffect, useState } from 'react'

const GITHUB_LATEST_API = 'https://api.github.com/repos/lll-gr/offer-pilot/releases/latest'
const CHECK_THROTTLE_KEY = 'updateCheckLastRun'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  downloadUrl: string
  releaseUrl: string
}

/** semver 比较：latest > current 返回 true（仅比 x.y.z 三段，缺段补零） */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (value: string) => {
    const parts = String(value || '')
      .replace(/^v/, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
    while (parts.length < 3) parts.push(0)
    return parts.slice(0, 3) as [number, number, number]
  }
  const [lMajor, lMinor, lPatch] = parse(latest)
  const [cMajor, cMinor, cPatch] = parse(current)

  if (lMajor !== cMajor) return lMajor > cMajor
  if (lMinor !== cMinor) return lMinor > cMinor
  return lPatch > cPatch
}

interface LatestReleasePayload {
  tag_name?: string
  html_url?: string
  assets?: Array<{ name?: string; browser_download_url?: string }>
}

async function fetchLatestRelease(): Promise<LatestReleasePayload | null> {
  // GitHub 访问可能失败（无代理环境常见）：8s 超时 + 全静默，拉不到 = 没有新版本
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(GITHUB_LATEST_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return (await response.json()) as LatestReleasePayload
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

async function shouldSkipThrottled(): Promise<boolean> {
  try {
    const data = (await chrome.storage.local.get([CHECK_THROTTLE_KEY])) as Record<string, unknown>
    const lastRun = Number(data[CHECK_THROTTLE_KEY] || 0)
    return Date.now() - lastRun < CHECK_INTERVAL_MS
  } catch {
    return false
  }
}

async function markCheckRan(): Promise<void> {
  try {
    await chrome.storage.local.set({ [CHECK_THROTTLE_KEY]: Date.now() })
  } catch {
    // Ignore.
  }
}

export function useUpdateChecker() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const currentVersion = chrome.runtime.getManifest().version
      const release = await fetchLatestRelease()
      if (!release?.tag_name) return

      const latestVersion = release.tag_name.replace(/^v/, '')
      if (!isNewerVersion(latestVersion, currentVersion)) return

      const zipAsset = release.assets?.find((asset) => asset.name?.endsWith('.zip'))
      setUpdate({
        currentVersion,
        latestVersion,
        downloadUrl: zipAsset?.browser_download_url || release.html_url || '',
        releaseUrl: release.html_url || '',
      })
    } finally {
      await markCheckRan()
      setChecking(false)
    }
  }, [])

  // 启动检查（24h 节流）；用户刚点过「忽略」本会话不再弹
  useEffect(() => {
    void (async () => {
      if (await shouldSkipThrottled()) return
      await check()
    })()
  }, [check])

  const dismiss = useCallback(() => setUpdate(null), [])

  return { update, checking, check, dismiss }
}
