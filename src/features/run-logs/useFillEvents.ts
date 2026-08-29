/**
 * 填充事件订阅状态机：isFillEvent 守卫订阅 content script 推送的 FillEvent 流，
 * 内聚派生状态——日志流 / 统计 / 实时进度（phase + 字段级）/ 会话记录（导出用）。
 * UI 只消费派生状态，不感知消息形状。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { FillEvent } from '@/messaging/events'
import { isFillEvent } from '@/messaging/events'
import { shouldRenderLogInUi } from '@/logs/visibility'
import type { FillSession } from '@/logs/export'
import {
  INITIAL_FIELD_PROGRESS,
  reduceFieldProgress,
} from '@/features/fill-flow/FillProgressPanel'
import type { FieldProgressState } from '@/features/fill-flow/FillProgressPanel'

/** 侧栏 UI 最多保留的日志条数（会话导出记录不受限） */
const MAX_UI_LOGS = 500

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

interface UseFillEventsOptions {
  onStats?: (stats: FillStats) => void
  onError?: (message: string) => void
}

export function useFillEvents({ onStats, onError }: UseFillEventsOptions = {}) {
  const [logs, setLogs] = useState<LogItem[]>([])
  const [progress, setProgress] = useState<FieldProgressState>(INITIAL_FIELD_PROGRESS)
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
      setLogs((prev) => {
        const next = [...prev, { id, level, message, time: formatLogTime() }]
        // 长会话防 DOM 无限膨胀：只保留最近 MAX_UI_LOGS 条
        return next.length > MAX_UI_LOGS ? next.slice(next.length - MAX_UI_LOGS) : next
      })
    }

    if (sessionRef.current) {
      sessionRef.current.logs.push({
        level,
        message,
        timestamp: now.toISOString(),
      })
    }
  }, [])

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
    setProgress(INITIAL_FIELD_PROGRESS)
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

  const clearLogs = useCallback(() => {
    setLogs([])
    addLog('info', '日志已清空')
  }, [addLog])

  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isFillEvent(message)) return
      const event = message as FillEvent

      switch (event.type) {
        case 'log':
          addLog(event.level, event.text)
          break
        case 'error':
          onErrorRef.current?.(event.text || '未知错误')
          addLog('error', event.text || '未知错误')
          break
        case 'stats': {
          const stats: FillStats = {
            fieldCount: event.fieldCount ?? 0,
            mappedCount: event.mappedCount ?? 0,
            filledCount: event.filledCount ?? 0,
          }
          onStatsRef.current?.(stats)
          if (sessionRef.current) {
            sessionRef.current.stats = stats
          }
          break
        }
        case 'phase':
          setProgress((prev) => reduceFieldProgress(prev, event))
          break
        case 'fieldProgress':
          setProgress((prev) => reduceFieldProgress(prev, event))
          break
      }
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [addLog])

  return {
    logs,
    addLog,
    clearLogs,
    progress,
    beginFillSession,
    finalizeFillSession,
  }
}
