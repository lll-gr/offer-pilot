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
  const [activeSection, setActiveSection] = useState<string>(SECTION_DEFINITIONS[0]?.key || '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 编程式跳转后短暂抑制观察器回写（平滑滚动途中的中间区块不覆盖目标高亮）
  const navLockUntilRef = useRef(0)

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
    setActiveSection(sectionKey)
    navLockUntilRef.current = Date.now() + 800
    window.setTimeout(() => {
      document.getElementById(`resume-section-${sectionKey}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }, [])

  // 反向联动：滚动到哪个区块，左侧导航高亮哪个。
  // IntersectionObserver 只做「该重新计算了」的触发信号；
  // 高亮归属每次实时测量所有区块（视口顶带内最靠上的区块胜出），
  // 不依赖回调 entries 的快照（快速滚动时 entries 会缺块导致高亮乱跳）。
  useEffect(() => {
    if (!loaded || typeof IntersectionObserver === 'undefined') return

    const recompute = () => {
      if (Date.now() < navLockUntilRef.current) return

      let best: { key: string; top: number } | null = null
      for (const section of SECTION_DEFINITIONS) {
        const el = document.getElementById(`resume-section-${section.key}`)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        // 视口顶带：[96px, 60%] 之间视为当前区块（上方 sticky 头让出 96px）
        const bandTop = 96
        const bandBottom = window.innerHeight * 0.6
        const overlaps = rect.bottom > bandTop && rect.top < bandBottom
        if (!overlaps) continue
        // 顶带内最靠上的区块优先；同 top（首个区块）取先出现者
        if (!best || rect.top < best.top) {
          best = { key: section.key, top: rect.top }
        }
      }
      if (best) setActiveSection(best.key)
    }

    const observer = new IntersectionObserver(recompute, {
      rootMargin: '0px 0px -40% 0px',
      threshold: [0, 0.1, 0.5, 1],
    })

    for (const section of SECTION_DEFINITIONS) {
      const el = document.getElementById(`resume-section-${section.key}`)
      if (el) observer.observe(el)
    }
    recompute()

    return () => observer.disconnect()
  }, [loaded])

  const handleSave = useCallback(async () => {
    const nextProfile = normalizeResumeProfile(editingProfile)
    await saveActive(nextProfile, rawText.trim())
    setLocalProfile(null)
    setIsDirty(false)
    markClean()
    importFlow.updateStatus('success', '标准简历已保存，侧边栏自动填充会立即使用这份数据。')
  }, [editingProfile, importFlow, markClean, rawText, saveActive])

  const statusBorder = STATUS_BORDER_COLORS[importFlow.status.type] || 'var(--border)'

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
        <header className="op-editor-header">
          <div className="op-editor-header-main">
            <img className="op-logo" src="/icons/icon128.png" alt="AI 简历填表助手图标" />
            <div className="op-editor-header-copy">
              <h1>简历配置</h1>
              <p>在宽页面里维护标准简历，保存后会同步给侧边栏自动填充流程。</p>
            </div>
          </div>
        </header>
        <main className="op-editor-main">
          <div className="op-hint">正在加载标准简历...</div>
        </main>
      </div>
    )
  }

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
        <div className="op-editor-topbar">
          <div className="op-editor-topbar-left">
          <SlotBar
            slots={slots}
            activeSlotId={activeSlotId}
            company={activeSlot?.company || ''}
            position={activeSlot?.position || ''}
            onSwitch={(slotId) => void switchSlot(slotId)}
            onCreate={(options) => void createNewSlot({ name: options.name || '新档位' })}
            onDuplicate={(options) =>
              void createNewSlot({
                name: options.name || '复制档位',
                copyFromId: options.copyFromId || activeSlotId,
              })
            }
            onDelete={() => void deleteSlot(activeSlotId)}
            onMetaChange={(meta) => updateMeta(meta)}
            compact
          />

          <div className="op-editor-topbar-meta">
            <div className="op-field">
              <label htmlFor="slotCompany">目标公司</label>
              <input
                id="slotCompany"
                type="text"
                placeholder="如：字节跳动（可选）"
                defaultValue={activeSlot?.company || ''}
                onBlur={(event) => updateMeta({ company: event.target.value })}
              />
            </div>
            <div className="op-field">
              <label htmlFor="slotPosition">目标职位</label>
              <input
                id="slotPosition"
                type="text"
                placeholder="如：后端开发工程师（可选）"
                defaultValue={activeSlot?.position || ''}
                onBlur={(event) => updateMeta({ position: event.target.value })}
              />
            </div>
          </div>
          </div>

          <div className="op-editor-import op-editor-import-compact">
            <label htmlFor="resumeImportText">导入简历</label>
            <p className="op-editor-import-desc">
              粘贴原始简历文本，或上传 PDF 自动提取内容，AI 会解析并预填到下方标准字段；导入后请检查并点击「保存标准简历」。
            </p>
            <textarea
              id="resumeImportText"
              className="op-ctrl-textarea op-editor-import-textarea"
              placeholder="粘贴原始简历文本，或上传 PDF 后自动填入这里。"
              value={rawText}
              onChange={handleImportTextChange}
              rows={4}
            />
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
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(event) => void handlePdfChange(event)}
            />
          </div>
        </div>

        <div className="op-hint" style={{ borderColor: statusBorder }}>
          {importFlow.status.text}
        </div>
        <div className="op-editor-layout">
          <ResumeNav
            profile={editingProfile}
            collapsedSections={collapsedSections}
            onNavigate={handleNavigate}
            activeSection={activeSection}
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

      </main>
    </div>
  )
}

