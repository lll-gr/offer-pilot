/**
 * 缓存管理：展示本地填表决策缓存条目（站点/路径/条数/更新时间），
 * 支持按站点清除与全部清空。数据结构与 plan/cache.ts 的 MappingCacheEntry 一致。
 */

import { useCallback, useEffect, useState } from 'react'

import { MAPPING_CACHE_KEY } from '@/messaging/bridge'

interface CacheEntryLike {
  host?: string
  path?: string
  updatedAt?: number
  decisions?: unknown[]
}

interface CacheRow {
  key: string
  host: string
  path: string
  count: number
  updatedAt: number
}

interface CacheManagerProps {
  onLog: (level: string, message: string) => void
}

async function readCacheRows(): Promise<CacheRow[]> {
  const data = (await chrome.storage.local.get([MAPPING_CACHE_KEY])) as Record<string, unknown>
  const cache = data?.[MAPPING_CACHE_KEY]
  if (!cache || typeof cache !== 'object') return []

  return Object.entries(cache as Record<string, CacheEntryLike>)
    .map(([key, entry]) => ({
      key,
      host: String(entry?.host || ''),
      path: String(entry?.path || ''),
      count: Array.isArray(entry?.decisions) ? entry.decisions.length : 0,
      updatedAt: Number(entry?.updatedAt || 0),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function CacheManager({ onLog }: CacheManagerProps) {
  const [rows, setRows] = useState<CacheRow[]>([])
  const [expanded, setExpanded] = useState(false)

  const refresh = useCallback(async () => {
    setRows(await readCacheRows())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const clearHost = async (host: string) => {
    const data = (await chrome.storage.local.get([MAPPING_CACHE_KEY])) as Record<string, unknown>
    const cache = data?.[MAPPING_CACHE_KEY] as Record<string, CacheEntryLike> | undefined
    if (!cache) return

    const next: Record<string, CacheEntryLike> = {}
    let removed = 0
    for (const [key, entry] of Object.entries(cache)) {
      if (String(entry?.host || '') === host) {
        removed += 1
        continue
      }
      next[key] = entry
    }

    await chrome.storage.local.set({ [MAPPING_CACHE_KEY]: next })
    onLog('success', `已清除 ${host} 的 ${removed} 条缓存`)
    await refresh()
  }

  const clearAll = async () => {
    await chrome.storage.local.set({ [MAPPING_CACHE_KEY]: {} })
    onLog('success', '已清空全部映射缓存')
    await refresh()
  }

  if (rows.length === 0) {
    return expanded ? <div className="op-hint">暂无缓存条目</div> : null
  }

  return (
    <div className="op-cache-manager">
      <button className="op-btn-text" onClick={() => setExpanded((prev) => !prev)}>
        {expanded ? '收起缓存管理' : `映射缓存（${rows.length} 个站点）`}
      </button>

      {expanded ? (
        <div className="op-cache-manager-body">
          <div className="op-cache-list">
            {rows.map((row) => (
              <div className="op-cache-row" key={row.key}>
                <div className="op-cache-info">
                  <span className="op-cache-host" title={`${row.host}${row.path}`}>
                    {row.host}
                  </span>
                  <span className="op-cache-meta">
                    {row.count} 条 · {new Date(row.updatedAt).toLocaleString()}
                  </span>
                </div>
                <button className="op-btn op-btn-ghost op-btn-xs" onClick={() => void clearHost(row.host)}>
                  清除
                </button>
              </div>
            ))}
          </div>
          <button className="op-btn op-btn-ghost op-btn-block op-btn-xs" onClick={() => void clearAll()}>
            清空全部缓存
          </button>
        </div>
      ) : null}
    </div>
  )
}
