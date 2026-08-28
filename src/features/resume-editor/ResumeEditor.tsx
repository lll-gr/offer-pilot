/**
 * 全页简历编辑器（unlisted page）：区块折叠/导航、增删条目、保存、AI/PDF 导入。
 * 编辑态以 localProfile 草稿持有，保存时一次性落盘。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  SECTION_DEFINITIONS,
  createEmptyListItem,
  getCatalogWithValues,
  getListSectionInitialItems,
  getListSectionMaxItems,
  getSectionDefinition,
  getSectionStats,
  normalizeResumeProfile,
  setValueByPath,
} from '@/resume/schema'
import type { ResumeProfile } from '@/resume/schema'
import { ResumeNav } from './ResumeSummaryGrid'
import { SectionCard } from './SectionCard'
import { SlotBar } from './SlotBar'
import { useResumeImport } from './useResumeImport'
import { useResumeSlots } from './useResumeSlots'

const STATUS_BORDER_COLORS: Record<string, string> = {
  error: 'rgba(239,68,68,0.28)',
  success: 'rgba(16,185,129,0.28)',
  warning: 'rgba(245,158,11,0.28)',
}

function cloneProfile(profile: ResumeProfile): ResumeProfile {
  return JSON.parse(JSON.stringify(profile)) as ResumeProfile
}

export function ResumeEditor() {
  const {
    profile,
    rawText,
    loaded,
    load,
    setRawText,
    markDirty,
    markClean,
    setStorageSyncPaused,
    slots,
    activeSlot,
    activeSlotId,
    switchSlot,
    createNewSlot,
    deleteSlot,
    saveActive,
    persistRawText,
    updateMeta,
  } = useResumeSlots()
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [localProfile, setLocalProfile] = useState<ResumeProfile | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const importFlow = useResumeImport({
    onImported: async (importedProfile, text) => {
      await saveActive(importedProfile, text)
      setCollapsedSections(new Set())
      setLocalProfile(null)
      setIsDirty(false)
    },
    onRawText: async (text) => {
      setRawText(text)
      await persistRawText(text)
    },
  })

  // 首次加载完成后的状态文案（与手动「重新加载」一致）
  useEffect(() => {
    if (!loaded) return
    const filledCount = getCatalogWithValues(profile).filter((field) => field.hasValue).length
    importFlow.updateStatus('info', `已加载标准简历。当前共填写 ${filledCount} 个有效字段。`)
    // 仅在首次加载时执行一次，importFlow.updateStatus 为稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  const editingProfile = localProfile ?? profile
  const sectionStats = useMemo(() => getSectionStats(editingProfile), [editingProfile])

  const collapseAll = useCallback(() => {
    setCollapsedSections(new Set(SECTION_DEFINITIONS.map((section) => section.key)))
  }, [])

  const markDirtyLocal = useCallback(() => {
    setIsDirty(true)
    markDirty()
    importFlow.updateStatus('warning', '有未保存的修改，记得点击“保存标准简历”。')
  }, [importFlow, markDirty])

  const handleLoad = useCallback(async () => {
    const data = await load()
    collapseAll()
    setLocalProfile(null)
    setIsDirty(false)
    const filledCount = getCatalogWithValues(data.profile).filter((field) => field.hasValue).length
    importFlow.updateStatus('info', `已加载标准简历。当前共填写 ${filledCount} 个有效字段。`)
  }, [collapseAll, importFlow, load])

  const handleFieldChange = useCallback(
    (path: string, value: string) => {
      const next = cloneProfile(editingProfile)
      setValueByPath(next, path, value.trim())
      setLocalProfile(next)
      markDirtyLocal()
    },
    [editingProfile, markDirtyLocal]
  )

  const updateItems = useCallback(
    (sectionKey: string, mutate: (items: Record<string, string>[]) => Record<string, string>[]) => {
      const section = getSectionDefinition(sectionKey)
      if (!section || section.type !== 'list') return

      const base = cloneProfile(editingProfile)
      const items = Array.isArray(base[sectionKey]) ? [...(base[sectionKey] as Record<string, string>[])] : []
      const nextItems = mutate(items)

      setLocalProfile(normalizeResumeProfile({ ...base, [sectionKey]: nextItems }))
      markDirtyLocal()
      setCollapsedSections((prev) => {
        const next = new Set(prev)
        next.delete(sectionKey)
        return next
      })
    },
    [editingProfile, markDirtyLocal]
  )

  const handleAddItem = useCallback(
    (sectionKey: string) => {
      const section = getSectionDefinition(sectionKey)
      if (!section || section.type !== 'list') return

      updateItems(sectionKey, (items) => {
        if (items.length >= getListSectionMaxItems(section)) return items
        return [...items, createEmptyListItem(sectionKey)]
      })
    },
    [updateItems]
  )

  const handleRemoveItem = useCallback(
    (sectionKey: string, itemIndex: number) => {
      const section = getSectionDefinition(sectionKey)
      if (!section || section.type !== 'list') return

      updateItems(sectionKey, (items) => {
        const minItems = Math.max(1, getListSectionInitialItems(section))
        if (items.length <= minItems) return items
        if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= items.length) return items

        const next = [...items]
        next.splice(itemIndex, 1)
        return next
      })
    },
    [updateItems]
  )

  const handleToggleSection = useCallback((sectionKey: string) => {
    if (!sectionKey) return
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionKey)) {
        next.delete(sectionKey)
      } else {
        next.add(sectionKey)
      }
      return next
    })
  }, [])

  const handleNavigate = useCallback((sectionKey: string) => {
    if (!sectionKey) return
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      next.delete(sectionKey)
      return next
    })
    window.setTimeout(() => {
      document.getElementById(`resume-section-${sectionKey}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }, [])

  const handleSave = useCallback(async () => {
    const nextProfile = normalizeResumeProfile(editingProfile)
    await saveActive(nextProfile, rawText.trim())
    setLocalProfile(null)
    setIsDirty(false)
    markClean()
    importFlow.updateStatus('success', '标准简历已保存，侧边栏自动填充会立即使用这份数据。')
  }, [editingProfile, importFlow, markClean, rawText, saveActive])

  const handleImportTextChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setRawText(event.target.value)
      markDirty()
      setIsDirty(true)
    },
    [markDirty, setRawText]
  )

  const handlePdfChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      if (!file) return

      setStorageSyncPaused(true)
      try {
        await importFlow.importFromPdf(file)
      } finally {
        setStorageSyncPaused(false)
      }
    },
    [importFlow, setStorageSyncPaused]
  )

  if (!loaded) {
    return (
      <div className="op-editor-shell">
        <main className="op-editor-main">
          <div className="op-hint">正在加载标准简历...</div>
        </main>
      </div>
    )
  }

  const statusBorder = STATUS_BORDER_COLORS[importFlow.status.type] || 'var(--border)'

  return (
    <div className="op-editor-shell">
      <header className="op-editor-header">
        <div className="op-editor-header-main">
          <img className="op-logo" src="/icons/icon128.png" alt="AI 简历填表助手图标" />
          <div className="op-editor-header-copy">
            <h1>简历配置</h1>
            <p>在宽页面里维护标准简历，保存后会同步给侧边栏自动填充流程。</p>
          </div>
        </div>
        <div className="op-editor-toolbar">
          <button className="op-btn op-btn-ghost" onClick={() => void handleLoad()}>
            重新加载
          </button>
          <button className="op-btn op-btn-primary" disabled={!isDirty} onClick={() => void handleSave()}>
            保存标准简历
          </button>
        </div>
      </header>

      <main className="op-editor-main">
        <SlotBar
          slots={slots}
          activeSlotId={activeSlotId}
          company={activeSlot?.company || ''}
          position={activeSlot?.position || ''}
          onSwitch={(slotId) => void switchSlot(slotId)}
          onCreate={() => void createNewSlot({ name: '新档位' })}
          onDuplicate={() => void createNewSlot({ name: '复制档位', copyFromId: activeSlotId })}
          onDelete={() => void deleteSlot(activeSlotId)}
          onMetaChange={(meta) => void updateMeta(meta)}
        />
        <div className="op-hint" style={{ borderColor: statusBorder }}>
          {importFlow.status.text}
        </div>
        <div className="op-editor-layout">
          <ResumeNav
            profile={editingProfile}
            collapsedSections={collapsedSections}
            onNavigate={handleNavigate}
          />
          <div className="op-editor-form-host">
            {SECTION_DEFINITIONS.map((section) => (
              <SectionCard
                key={section.key}
                section={section}
                stats={sectionStats.get(section.key)}
                profile={editingProfile}
                collapsed={collapsedSections.has(section.key)}
                onToggle={handleToggleSection}
                onChange={handleFieldChange}
                onAddItem={handleAddItem}
                onRemoveItem={handleRemoveItem}
              />
            ))}
          </div>
        </div>

        <div className="op-editor-import">
          <div className="op-editor-import-header">
            <div className="op-editor-import-icon">⬆</div>
            <div className="op-editor-import-copy">
              <div className="op-editor-import-title">导入辅助（可选）</div>
              <div className="op-editor-import-desc">
                粘贴原始简历文本或上传 PDF，用 AI 预填标准字段，导入后请检查并保存。
              </div>
            </div>
          </div>
          <div className="op-editor-import-body">
            <div className="op-field" style={{ marginBottom: 0 }}>
              <label htmlFor="resumeImportText">原始简历文本</label>
              <textarea
                id="resumeImportText"
                className="op-ctrl-textarea"
                placeholder="粘贴原始简历文本，或上传 PDF 后自动填入这里。"
                value={rawText}
                onChange={handleImportTextChange}
              />
            </div>
            <div className="op-editor-import-actions">
              <button
                className="op-btn op-btn-primary"
                disabled={importFlow.importing}
                onClick={() => void importFlow.importFromText(rawText.trim())}
              >
                {importFlow.importing ? '导入中...' : 'AI 导入到标准简历'}
              </button>
              <button
                className="op-btn op-btn-ghost"
                disabled={importFlow.importing}
                onClick={() => fileInputRef.current?.click()}
              >
                上传 PDF 并导入
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(event) => void handlePdfChange(event)}
          />
        </div>
      </main>
    </div>
  )
}

