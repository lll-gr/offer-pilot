/**
 * 填充流程 hook：runFill 编排（ping 握手 → startFill → 统计/提示/日志）。
 * 新版 content script 由 manifest 声明式注册，无需按需注入。
 */

import { useCallback, useRef, useState } from 'react'

import { getActiveModel, isConfiguredModel } from '@/models/storage'
import { MAPPING_CACHE_KEY, contentScriptHasDiagnosticsSupport } from '@/messaging/bridge'
import type { StartFillResponse } from '@/messaging/bridge'
import { hasAnyFilledField } from '@/resume/schema'
import type { ResumeProfile } from '@/resume/schema'
import { getActiveTab, isSupportedWebPageUrl, sendTabMessage } from '@/lib/tabs'
import type { FillStats } from '@/features/run-logs/useRunLog'

export type FillActionKey = 'overwritePage' | 'incrementalPage' | 'selection' | 'segmentedPage'

export interface FillActionConfig {
  triggerText: string
  runningText: string
  statusText: string
  startLog: string
  doneLog: string
  fillMode: 'overwrite' | 'incremental' | 'segmented'
  scope: 'page' | 'selection'
}

export const FILL_ACTIONS: Record<FillActionKey, FillActionConfig> = {
  overwritePage: {
    triggerText: '开始填充',
    runningText: '填充中...',
    statusText: '映射中...',
    startLog: '开始识别页面字段，准备进行 AI 字段映射...',
    doneLog: '填充完成',
    fillMode: 'overwrite',
    scope: 'page',
  },
  incrementalPage: {
    triggerText: '增量填入',
    runningText: '增量中...',
    statusText: '增量映射中...',
    startLog: '开始增量填入：已有内容的字段会自动跳过。',
    doneLog: '增量填入完成',
    fillMode: 'incremental',
    scope: 'page',
  },
  selection: {
    triggerText: '选区填入',
    runningText: '等待选区...',
    statusText: '等待选区...',
    startLog: '准备选区填入：请回到网页并拖拽框选要填写的区域。',
    doneLog: '选区填入完成',
    fillMode: 'overwrite',
    scope: 'selection',
  },
  segmentedPage: {
    triggerText: '分步填入',
    runningText: '分步中...',
    statusText: '分步映射中...',
    startLog: '开始分步填入：逐块填写，每块完成后请点击页面上的下一步按钮。',
    doneLog: '分步填充完成',
    fillMode: 'segmented',
    scope: 'page',
  },
}

export function buildFillTipText(actionKey: FillActionKey, cacheHit?: boolean): string {
  const modeLabel =
    actionKey === 'incrementalPage'
      ? '增量填入'
      : actionKey === 'selection'
        ? '选区填入'
        : actionKey === 'segmentedPage'
          ? '分步填入'
          : '本次填充'

  return cacheHit
    ? `${modeLabel}复用了本地字段映射缓存。`
    : `${modeLabel}已生成新的字段映射，并写入本地缓存。`
}

export type FillStatusType = 'ready' | 'running' | 'error'

interface UseFillFlowOptions {
  resumeProfile: ResumeProfile
  onLog: (level: string, message: string) => void
  onStats: (stats: FillStats) => void
  onStatus: (type: FillStatusType, text: string) => void
  onSessionBegin: (tab: { id: number | null; url: string; title: string }) => void
  onSessionEnd: (result: {
    status: string
    stats?: Partial<FillStats>
    errorMessage?: string
  }) => Promise<void>
  onRequireResume: () => void
  onRequireSettings: () => void
}

export function useFillFlow({
  resumeProfile,
  onLog,
  onStats,
  onStatus,
  onSessionBegin,
  onSessionEnd,
  onRequireResume,
  onRequireSettings,
}: UseFillFlowOptions) {
  const [isFilling, setIsFilling] = useState(false)
  const [runningAction, setRunningAction] = useState<FillActionKey | null>(null)
  const [fillTip, setFillTip] = useState<string | null>(null)
  const isFillingRef = useRef(false)

  const runFill = useCallback(
    async (actionKey: FillActionKey) => {
      // ref 同步守卫：双击在 React 重渲染前也能被拦截
      if (isFillingRef.current) return
      isFillingRef.current = true

      try {
        const actionConfig = FILL_ACTIONS[actionKey]
        if (!actionConfig) {
          throw new Error(`未知填充动作：${actionKey}`)
        }

        if (!hasAnyFilledField(resumeProfile)) {
          onLog('warning', '请先在“标准简历”里填写至少一个字段')
          onRequireResume()
          return
        }

        const activeModel = await getActiveModel()
        if (!isConfiguredModel(activeModel)) {
          onLog('error', '请先在设置中配置模型')
          onRequireSettings()
          return
        }

        const tab = await getActiveTab()
        if (!tab) {
          onLog('error', '无法获取当前标签页')
          return
        }

        if (!tab.url) {
          onLog('error', '无法读取当前网页地址，请重新加载扩展后再试')
          onStatus('error', '网页权限不可用')
          return
        }

        if (!isSupportedWebPageUrl(tab.url)) {
          onLog('error', '请切换到要填写的网页（非系统页面）')
          onStatus('error', '系统页面')
          return
        }

        setIsFilling(true)
        setRunningAction(actionKey)
        setFillTip(null)
        onStatus('running', actionConfig.statusText)
        onSessionBegin(tab)
        onLog('info', actionConfig.startLog)

        try {
          if (!tab.id) {
            throw new Error('无法获取当前标签页')
          }

          // ping 握手：确认 content script 存在且版本支持完整诊断
          const pong = await sendTabMessage<{ success?: boolean }>(tab.id, { action: 'ping' }).catch(() => null)
          if (!contentScriptHasDiagnosticsSupport(pong)) {
            throw new Error('当前页面尚未加载填表脚本。刷新当前页面一次后再重试即可')
          }

          const response = await sendTabMessage<StartFillResponse>(tab.id, {
            action: 'startFill',
            modelId: activeModel.id,
            resumeProfile,
            fillMode: actionConfig.fillMode,
            scope: actionConfig.scope,
          })

          if (!response?.success) {
            if (response?.canceled) {
              onLog('info', response.message || '已取消本次操作')
              onStatus('ready', '已取消')
              // 不传 stats：会话统计由 useRunLog 跟踪的中途 updateStats 保留
              await onSessionEnd({
                status: 'canceled',
                errorMessage: response.message || '',
              })
              return
            }
            throw new Error(response?.message || '填充失败')
          }

          const stats: FillStats = {
            fieldCount: response.fieldCount || 0,
            mappedCount: response.mappedCount || 0,
            filledCount: response.filledCount || 0,
          }
          onStats(stats)
          setFillTip(buildFillTipText(actionKey, response.cacheHit))

          onLog(
            'success',
            `${actionConfig.doneLog}：识别 ${stats.fieldCount} 个字段，映射 ${stats.mappedCount} 个，成功填充 ${stats.filledCount} 个。`
          )
          onStatus('ready', '完成')
          await onSessionEnd({ status: 'success', stats })
        } catch (error) {
          onLog('error', `填充失败：${(error as Error).message}`)
          onStatus('error', '失败')
          // 不传 stats：会话统计保留 useRunLog 跟踪的中途值
          await onSessionEnd({
            status: 'error',
            errorMessage: (error as Error).message,
          })
        } finally {
          setIsFilling(false)
          setRunningAction(null)
        }
      } finally {
        isFillingRef.current = false
      }
    },
    [
      resumeProfile,
      onLog,
      onStats,
      onStatus,
      onSessionBegin,
      onSessionEnd,
      onRequireResume,
      onRequireSettings,
    ]
  )

  const clearMappingCache = useCallback(async () => {
    await chrome.storage.local.remove(MAPPING_CACHE_KEY)
    onLog('success', '字段映射缓存已清空')
    setFillTip(null)
  }, [onLog])

  return { isFilling, runningAction, fillTip, runFill, clearMappingCache }
}
