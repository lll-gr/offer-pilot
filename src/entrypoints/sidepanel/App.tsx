/**
 * 侧边栏主界面：填充流程 + 简历摘要 + 运行日志 + 模型设置。
 */

import { useCallback, useState } from 'react'

import GithubIcon from '@/assets/icons/github.svg'
import { FillPanel } from '@/features/fill-flow/FillPanel'
import { FillProgressPanel } from '@/features/fill-flow/FillProgressPanel'
import { FillReportPanel } from '@/features/fill-flow/FillReportPanel'
import { MappingCorrection } from '@/features/fill-flow/MappingCorrection'
import { useFillFlow } from '@/features/fill-flow/useFillFlow'
import type { FillActionKey } from '@/features/fill-flow/useFillFlow'
import { ResumeSummaryGrid } from '@/features/resume-editor/ResumeSummaryGrid'
import { SlotBar } from '@/features/resume-editor/SlotBar'
import { useResumeSlots } from '@/features/resume-editor/useResumeSlots'
import { useModels } from '@/features/model-settings/useModels'
import { SettingsPanel } from '@/features/model-settings/SettingsPanel'
import { UpdateBanner } from '@/features/update-checker/UpdateBanner'
import { useLogExport } from '@/features/run-logs/useLogExport'
import { useFillEvents } from '@/features/run-logs/useFillEvents'
import type { FillStats } from '@/features/run-logs/useFillEvents'
import { openResumeEditorPage } from '@/lib/tabs'
import { hasAnyFilledField } from '@/resume/schema'

const INITIAL_STATS: FillStats = { fieldCount: 0, mappedCount: 0, filledCount: 0 }

/** 顶层视图（page-agent 判别联合模式：视图与参数内联，编译期可查） */
type View = { name: 'fill' } | { name: 'resume' } | { name: 'settings' }

const NAV_ITEMS: Array<{ view: View; label: string }> = [
  { view: { name: 'fill' }, label: '自动填充' },
  { view: { name: 'resume' }, label: '标准简历' },
  { view: { name: 'settings' }, label: '设置' },
]

export function SidepanelApp() {
  const [view, setView] = useState<View>({ name: 'fill' })
  const [stats, setStats] = useState<FillStats>(INITIAL_STATS)
  const [status, setStatus] = useState<{ type: string; text: string }>({
    type: '',
    text: '等待开始',
  })

  const resumeApi = useResumeSlots()
  const modelsApi = useModels()

  const updateStatus = useCallback((type: string, text: string) => {
    setStatus({ type, text })
  }, [])

  const fillEvents = useFillEvents({
    onStats: setStats,
    onError: (message) => {
      updateStatus('error', '错误')
      fillEvents.addLog('error', message)
    },
  })
  const logExport = useLogExport(fillEvents.addLog)

  const handleSessionEnd = useCallback(
    async (result: { status: string; stats?: Partial<FillStats>; errorMessage?: string }) => {
      const session = await fillEvents.finalizeFillSession(result)
      if (session) {
        await logExport.exportSession(session)
      }
    },
    [logExport, fillEvents]
  )

  const fillFlow = useFillFlow({
    resumeProfile: resumeApi.profile,
    onLog: fillEvents.addLog,
    onStats: setStats,
    onStatus: updateStatus,
    onSessionBegin: fillEvents.beginFillSession,
    onSessionEnd: handleSessionEnd,
    onRequireResume: () => setView({ name: 'resume' }),
    onRequireSettings: () => setView({ name: 'settings' }),
  })

  const hasResumeData = hasAnyFilledField(resumeApi.profile)

  // 模型未就绪（无模型或激活模型缺 key）：填充页顶部引导条
  const activeModel = modelsApi.models.find((model) => model.id === modelsApi.activeModelId)
  const hasModelKey = Boolean(activeModel?.apiKey)

  return (
    <div className="op-shell">
      <header className="op-header">
        <div className="op-brand">
          <img className="op-logo" src="/icons/icon128.png" alt="Offer Pilot" />
          <span className="op-brand-name">Offer Pilot</span>
          <div className="op-status">
            <span className={`op-status-dot ${status.type}`}></span>
            <span className="op-status-text">{status.text}</span>
          </div>
        </div>
        <div className="op-header-actions">
          <button
            className="op-icon-btn"
            title="GitHub 仓库"
            onClick={() => void chrome.tabs.create({ url: 'https://github.com/lll-gr/offer-pilot' })}
          >
            <GithubIcon width={18} height={18} />
          </button>
        </div>
      </header>

      <UpdateBanner />

      <nav className="op-navstrip" role="navigation">
        {NAV_ITEMS.map(({ view: navView, label }) => (
          <button
            key={label}
            type="button"
            className={`op-navstrip-btn ${view.name === navView.name ? 'active' : ''}`}
            onClick={() => setView(navView)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="op-main">
        {view.name === 'fill' ? (
          <>
            {!hasModelKey ? (
              <button className="op-empty-resume" onClick={() => setView({ name: 'settings' })}>
                <span className="op-empty-resume-title">模型未配置，填充前请先填 API Key</span>
                <span className="op-empty-resume-action">去配置 →</span>
              </button>
            ) : null}
            <FillPanel
              stats={stats}
              hasResumeData={hasResumeData}
              isFilling={fillFlow.isFilling}
              runningAction={fillFlow.runningAction}
              fillTip={fillFlow.fillTip}
              onRun={(actionKey: FillActionKey) => void fillFlow.runFill(actionKey)}
              onClearCache={() => setView({ name: 'settings' })}
              onCancel={() => void fillFlow.cancelFill()}
              onRequireResume={() => setView({ name: 'resume' })}
            />
            {fillFlow.isFilling ? (
              <FillProgressPanel progress={fillEvents.progress} />
            ) : (
              <>
                <FillReportPanel report={fillFlow.fieldReport} />
                <MappingCorrection onLog={fillEvents.addLog} refreshKey={stats.filledCount + stats.mappedCount} />
              </>
            )}
          </>
        ) : view.name === 'resume' ? (
          <section className="op-panel active">
            <div className="op-section">
              <div className="op-section-header">
                <span>简历配置</span>
              </div>
              <SlotBar
                slots={resumeApi.slots}
                activeSlotId={resumeApi.activeSlotId}
                company={resumeApi.activeSlot?.company || ''}
                position={resumeApi.activeSlot?.position || ''}
                onSwitch={(slotId) => void resumeApi.switchSlot(slotId)}
                onCreate={(options) => void resumeApi.createNewSlot({ name: options.name || '新档位' })}
                onDuplicate={(options) =>
                  void resumeApi.createNewSlot({
                    name: options.name || '复制档位',
                    copyFromId: options.copyFromId || resumeApi.activeSlotId,
                  })
                }
                onDelete={() => void resumeApi.deleteSlot(resumeApi.activeSlotId)}
                onMetaChange={(meta) => void resumeApi.updateMeta(meta)}
              />
              <div className="op-hint">
                简历字段较多，推荐在独立网页里编辑。新页面会复用当前扩展里的同一份标准简历数据。
              </div>
              <div className="op-launch-card">
                <div className="op-launch-copy">
                  <div className="op-launch-title">在宽页面里配置个人简历</div>
                  <div className="op-launch-desc">
                    更适合填写长文本、工作经历、教育经历和项目说明，保存后会立即同步到自动填充流程。
                  </div>
                </div>
                <button className="op-btn op-btn-primary" onClick={() => void openResumeEditorPage()}>
                  打开简历配置页
                </button>
              </div>
              <ResumeSummaryGrid profile={resumeApi.profile} />
            </div>
          </section>
        ) : (
          <SettingsPanel
            onNavigate={setView}
            onLog={fillEvents.addLog}
            logs={fillEvents.logs}
            onClearLogs={fillEvents.clearLogs}
            logExport={logExport}
          />
        )}
      </main>


    </div>
  )
}
