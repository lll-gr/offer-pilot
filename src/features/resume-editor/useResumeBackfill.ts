/**
 * 页面回填简历 hook：扫描当前页面已填值 → AI 映射 → 补充标准简历空缺字段。
 * 编排在 sidepanel（AI 调用与档案写入都在扩展上下文），content 只提供只读快照。
 */

import { useCallback, useRef, useState } from 'react'

import { callAI } from '@/ai/client'
import { getActiveModel, isConfiguredModel } from '@/models/storage'
import { contentScriptHasDiagnosticsSupport } from '@/messaging/bridge'
import type { CollectFilledFieldsResponse, FilledFieldSnapshot } from '@/messaging/bridge'
import { getActiveTab, isSupportedWebPageUrl, sendTabMessage } from '@/lib/tabs'
import type { ResumeProfile } from '@/resume/schema'
import {
  applyBackfillToProfile,
  buildBackfillPayload,
  parseBackfillMappings,
} from '@/resume/backfill'

interface UseResumeBackfillOptions {
  profile: ResumeProfile
  onLog: (level: string, message: string) => void
  onStatus: (type: 'ready' | 'running' | 'error', text: string) => void
  /** 应用回填结果并落盘（调用方负责归一化与档位写入） */
  saveProfile: (nextProfile: ResumeProfile) => Promise<void>
  onRequireSettings: () => void
}

export function useResumeBackfill({
  profile,
  onLog,
  onStatus,
  saveProfile,
  onRequireSettings,
}: UseResumeBackfillOptions) {
  const [isBackfilling, setIsBackfilling] = useState(false)
  const runningRef = useRef(false)

  const runBackfill = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true

    try {
      const activeModel = await getActiveModel()
      if (!isConfiguredModel(activeModel)) {
        // isConfiguredModel 收窄了 null，但 TS 对跨 await 的窄化不保留，显式断言
        onLog('error', '请先在设置中配置模型')
        onRequireSettings()
        return
      }

      const tab = await getActiveTab()
      if (!tab?.id || !tab.url || !isSupportedWebPageUrl(tab.url)) {
        onLog('error', '请切换到要回收信息的网页（非系统页面）')
        return
      }

      const pong = await sendTabMessage<{ success?: boolean }>(tab.id, { action: 'ping' }).catch(() => null)
      if (!contentScriptHasDiagnosticsSupport(pong)) {
        onLog('error', '当前页面尚未加载填表脚本。刷新当前页面一次后再重试即可')
        return
      }

      setIsBackfilling(true)
      onStatus('running', '扫描页面已填内容...')

      const collected = await sendTabMessage<CollectFilledFieldsResponse>(tab.id, {
        action: 'collectFilledFields',
      })
      const fields: FilledFieldSnapshot[] = collected?.success ? collected.fields || [] : []
      if (fields.length === 0) {
        onLog('warning', '页面上没有识别到已填写的内容，无需回填。')
        onStatus('ready', '完成')
        return
      }

      onLog('info', `已扫描到 ${fields.length} 个已填字段，正在调用 AI 分析可回填到简历的项...`)

      const payload = buildBackfillPayload(fields, profile, { url: tab.url, title: tab.title })
      const aiText = await callAI(activeModel!.id, JSON.stringify(payload), 'resume_update')
      const mappings = parseBackfillMappings(aiText, fields)
      if (mappings.length === 0) {
        onLog('info', 'AI 未找到可映射到标准简历的页面字段。')
        onStatus('ready', '完成')
        return
      }

      const { profile: nextProfile, result } = applyBackfillToProfile(profile, fields, mappings)

      for (const update of result.updates) {
        onLog(
          'info',
          `回填 ${update.resumePath} ← 「${update.sourceLabel}」：${update.value.slice(0, 60)}${update.value.length > 60 ? '...' : ''}`,
        )
      }
      for (const conflict of result.conflicts) {
        onLog(
          'warning',
          `冲突未覆盖 ${conflict.resumePath}：简历已有「${conflict.resumeValue}」，页面为「${conflict.pageValue}」（来自「${conflict.sourceLabel}」）`,
        )
      }

      if (result.updates.length > 0) {
        await saveProfile(nextProfile)
        const conflictNote = result.conflicts.length > 0 ? `，${result.conflicts.length} 处与现有内容不一致已保留原值` : ''
        onLog('success', `已回填 ${result.updates.length} 个字段到标准简历${conflictNote}。可到「标准简历」检查。`)
      } else {
        onLog('info', '简历暂无可补充的空缺字段。')
      }

      onStatus('ready', '完成')
    } catch (error) {
      onLog('error', `回填失败：${(error as Error).message}`)
      onStatus('error', '失败')
    } finally {
      setIsBackfilling(false)
      runningRef.current = false
    }
  }, [profile, onLog, onStatus, saveProfile, onRequireSettings])

  return { isBackfilling, runBackfill }
}
