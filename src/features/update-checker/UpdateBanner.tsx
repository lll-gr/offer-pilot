/**
 * 更新提示条：发现新版本时置顶显示。仅提示与直达下载——
 * 开发者模式扩展的替换必须用户手动完成（解压覆盖 + 扩展页刷新）。
 */

import { useUpdateChecker } from './useUpdateChecker'

export function UpdateBanner() {
  const { update, dismiss } = useUpdateChecker()
  if (!update) return null

  return (
    <div className="op-update-banner">
      <span className="op-update-banner-text">
        发现新版本 <strong>v{update.latestVersion}</strong>（当前 v{update.currentVersion}）
      </span>
      <span className="op-update-banner-actions">
        <a
          className="op-btn-text op-update-banner-link"
          href={update.releaseUrl}
          target="_blank"
          rel="noreferrer"
        >
          更新日志
        </a>
        <button
          className="op-btn op-btn-primary op-btn-xs"
          onClick={() => void chrome.tabs.create({ url: update.downloadUrl })}
        >
          下载新版本
        </button>
        <button className="op-icon-btn op-update-banner-close" title="忽略" onClick={dismiss}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </span>
    </div>
  )
}
