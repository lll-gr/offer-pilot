/**
 * 简历导入 hook：文本/PDF → AI 解析 → 归一化 profile 落盘。
 */

import { useCallback, useState } from 'react'

import { callAI } from '@/ai/client'
import { parseJsonFromAiText } from '@/ai/json'
import { getActiveModel, isConfiguredModel } from '@/models/storage'
import { buildResumeImportPrompt, limitTextForPrompt } from '@/resume/prompts'
import { extractTextFromPdf } from '@/resume/pdf'
import { normalizeResumeProfile } from '@/resume/schema'
import type { ResumeProfile } from '@/resume/schema'

export type PageStatusType = 'info' | 'success' | 'warning' | 'error'

interface UseResumeImportOptions {
  onImported: (profile: ResumeProfile, rawText: string) => Promise<void>
  onRawText: (text: string) => Promise<void>
}

/** PDF 导入大小上限（与 config.yaml 声明一致，防超大文件卡死 worker） */
const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024

export function useResumeImport({ onImported, onRawText }: UseResumeImportOptions) {
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState<{ type: PageStatusType; text: string }>({
    type: 'info',
    text: '正在加载标准简历...',
  })

  const updateStatus = useCallback((type: PageStatusType, text: string) => {
    setStatus({ type, text })
  }, [])

  const importFromText = useCallback(
    async (rawText: string) => {
      const text = String(rawText || '').trim()
      if (!text) {
        updateStatus('warning', '请先粘贴原始简历文本，或上传 PDF。')
        return
      }

      const activeModel = await getActiveModel()
      if (!isConfiguredModel(activeModel)) {
          // isConfiguredModel 收窄了 null，但 TS 对跨 await 的窄化不保留，显式断言
        updateStatus('error', '请先在侧边栏的模型设置中配置可用模型。')
        return
      }

      setImporting(true)
      updateStatus('info', '正在调用 AI 导入到标准简历...')

      try {
        const limited = limitTextForPrompt(text)
        if (limited !== text) {
          updateStatus('warning', `文本过长（${text.length} 字），已截断前 ${limited.length} 字用于导入。`)
        }

        const prompt = buildResumeImportPrompt(limited)
        const aiText = await callAI(activeModel!.id, prompt, 'resume_import')
        const parsed = parseJsonFromAiText(aiText)
        const normalized = normalizeResumeProfile(parsed)

        await onImported(normalized, text)
        updateStatus('success', '导入完成：已预填到标准简历，请检查后保存。')
      } catch (error) {
        updateStatus('error', `导入失败：${(error as Error).message}`)
      } finally {
        setImporting(false)
      }
    },
    [onImported, updateStatus]
  )

  const importFromPdf = useCallback(
    async (file: File) => {
      if (file.type && file.type !== 'application/pdf') {
        updateStatus('error', '请选择 PDF 文件。')
        return
      }

      if (file.size > MAX_PDF_SIZE_BYTES) {
        updateStatus('error', `PDF 过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请上传 10MB 以内的文件。`)
        return
      }

      setImporting(true)
      updateStatus('info', `正在提取 PDF 文本：${file.name}`)

      try {
        const text = await extractTextFromPdf(file, (page, total) => {
          updateStatus('info', `正在解析 PDF (${page}/${total})...`)
        })

        if (!text) {
          throw new Error('未提取到文本：如果是扫描版 PDF，请先转为可复制文字或使用 OCR')
        }

        await onRawText(text)
        updateStatus('success', 'PDF 文本提取完成，开始导入到标准简历...')
        await importFromText(text) // 内部自行接管 importing 状态（无闪烁：React 批处理合并两次 set）
      } catch (error) {
        updateStatus('error', `PDF 导入失败：${(error as Error).message}`)
        setImporting(false)
      }
    },
    [importFromText, onRawText, updateStatus]
  )

  return { importing, status, updateStatus, importFromText, importFromPdf }
}
