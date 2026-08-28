/**
 * 运行日志 hook：接收 content script 的 log/updateStats/error 通知，
 * 同时维护 FillSession 记录（供目录自动导出）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { shouldRenderLogInUi } from '@/logs/visibility'
import type { FillSession } from '@/logs/export'

export interface LogItem {
  id: number
  level: string
  message: string
  time: string
}

export interface FillStats {
  fieldCount: number
  mappedCount: number
  filledCount: number
}

function formatLogTime(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface UseRunLogOptions {
  onStats?: (stats: FillStats) => void
  onError?: (message: string) => void
}

export function useRunLog({ onStats, onError }: UseRunLogOptions = {}) {
  const [logs, setLogs] = useState<LogItem[]>([])
  const logSeqRef = useRef(0)
  const sessionRef = useRef<FillSession | null>(null)
  const onStatsRef = useRef(onStats)
  const onErrorRef = useRef(onError)

  onStatsRef.current = onStats
  onErrorRef.current = onError

  const addLog = useCallback((level: string, message: string) => {
    const now = new Date()
    logSeqRef.current += 1
    const id = logSeqRef.current

    if (shouldRenderLogInUi(level, message)) {
      setLogs((prev) => [...prev, { id, level, message, time: formatLogTime() }])
    }

    if (sessionRef.current) {
      sessionRef.current.logs.push({
        level,
        message,
        timestamp: now.toISOString(),
      })
    }
  }, [])

  const updateStats = useCallback((stats: FillStats) => {
    onStatsRef.current?.(stats)
    if (sessionRef.current) {
      sessionRef.current.stats = {
        fieldCount: Number(stats.fieldCount || 0),
        mappedCount: Number(stats.mappedCount || 0),
        filledCount: Number(stats.filledCount || 0),
      }
    }
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
    addLog('info', '日志已清空')
  }, [addLog])

  const beginFillSession = useCallback((tab: { id: number | null; url: string; title: string }) => {
    sessionRef.current = {
      id: `fill-${Date.now()}`,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'running',
      errorMessage: '',
      tab: {
        id: tab?.id ?? null,
        url: tab?.url || '',
        title: tab?.title || '',
      },
      stats: {
        fieldCount: 0,
        mappedCount: 0,
        filledCount: 0,
      },
      logs: [],
    }
  }, [])

  const finalizeFillSession = useCallback(
    async ({
      status,
      stats,
      errorMessage = '',
    }: {
      status: string
      stats?: Partial<FillStats>
      errorMessage?: string
    }): Promise<FillSession | null> => {
      const session = sessionRef.current
      if (!session) return null

      sessionRef.current = null
      session.endedAt = new Date().toISOString()
      session.status = (status || 'unknown') as FillSession['status']
      session.errorMessage = errorMessage
      session.stats = {
        ...session.stats,
        ...(stats || {}),
      }
      return session
    },
    []
  )

  useEffect(() => {
    const listener = (
      message: {
        type?: string
        level?: string
        text?: string
        fieldCount?: number
        mappedCount?: number
        filledCount?: number
      }
    ) => {
      switch (message.type) {
        case 'log':
          addLog(message.level || 'info', message.text || '')
          break
        case 'updateStats':
          updateStats({
            fieldCount: message.fieldCount ?? 0,
            mappedCount: message.mappedCount ?? 0,
            filledCount: message.filledCount ?? 0,
          } as FillStats)
          break
        case 'error':
          onErrorRef.current?.(message.text || '未知错误')
          addLog('error', message.text || '未知错误')
          break
        default:
          break
      }
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [addLog, updateStats])

  return {
    logs,
    addLog,
    clearLogs,
    updateStats,
    beginFillSession,
    finalizeFillSession,
  }
}
