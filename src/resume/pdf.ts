/**
 * PDF 文本提取：pdfjs-dist worker 化封装（浏览器端）。
 * 提取策略与旧版一致：逐页取文本，hasEOL 换行，压缩多余空白。
 */

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'

let workerReady = false

async function ensureWorker(): Promise<void> {
  if (workerReady) return

  try {
    const PdfWorker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')).default
    GlobalWorkerOptions.workerPort = new PdfWorker()
  } catch {
    // Node/测试环境：留空 worker 配置，pdfjs 走 fake worker
  }
  workerReady = true
}

export async function extractTextFromPdf(
  file: File,
  onProgress?: (page: number, total: number) => void
): Promise<string> {
  await ensureWorker()

  const data = await file.arrayBuffer()
  const pdf = await getDocument({ data }).promise

  const total = pdf.numPages || 0
  const parts: string[] = []

  for (let pageNo = 1; pageNo <= total; pageNo += 1) {
    onProgress?.(pageNo, total)
    const page = await pdf.getPage(pageNo)
    const content = await page.getTextContent()

    for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
      parts.push(item.str || '')
      parts.push(item.hasEOL ? '\n' : ' ')
    }

    parts.push('\n\n')
  }

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
