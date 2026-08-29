/**
 * 缓存管理：展示本地填表决策缓存条目（站点/路径/条数/更新时间），
 * 支持按站点清除与全部清空。设置分区形态：直接平铺 + 空态引导。
 * 数据结构与 plan/cache.ts 的 MappingCacheEntry 一致。
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
    if (!window.confirm('确定清空全部映射缓存？下次填充将重新调用 AI 建立映射。')) return
    await chrome.storage.local.set({ [MAPPING_CACHE_KEY]: {} })
    onLog('success', '已清空全部映射缓存')
    await refresh()
  }

  if (rows.length === 0) {
    return (
      <div className="op-cache-empty">
        还没有任何缓存。完成一次自动填充后，该页面的字段映射与填充决策会缓存在这里，下次同结构表单直接复用（跳过 AI）。
      </div>
    )
  }

  return (
    <div className="op-cache-manager">
      <div className="op-cache-list">
        {rows.map((row) => (
          <div className="op-cache-row" key={row.key}>
            <div className="op-cache-info">
              <span className="op-cache-host" title={`${row.host}${row.path}`}>
                {row.host}
              </span>
              <span className="op-cache-meta">
                {row.count} 条决策 · {new Date(row.updatedAt).toLocaleString()}
              </span>
            </div>
            <button className="op-btn op-btn-ghost op-btn-xs" onClick={() => void clearHost(row.host)}>
              清除
            </button>
          </div>
        ))}
      </div>
      <button className="op-btn op-btn-ghost op-btn-block op-btn-xs" onClick={() => void clearAll()}>
        清空全部缓存（{rows.length} 个站点）
      </button>
    </div>
  )
}
