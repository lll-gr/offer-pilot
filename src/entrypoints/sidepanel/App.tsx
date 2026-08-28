/**
 * 侧边栏主界面：填充流程 + 简历摘要 + 运行日志 + 模型设置。
 */

import { useCallback, useState } from 'react'

import GearIcon from '@/assets/icons/gear.svg'
import { FillPanel } from '@/features/fill-flow/FillPanel'
import { useFillFlow } from '@/features/fill-flow/useFillFlow'
import type { FillActionKey } from '@/features/fill-flow/useFillFlow'
import { ResumeSummaryGrid } from '@/features/resume-editor/ResumeSummaryGrid'
import { SlotBar } from '@/features/resume-editor/SlotBar'
import { useResumeSlots } from '@/features/resume-editor/useResumeSlots'
import { SettingsModal } from '@/features/model-settings/SettingsModal'
import { useModels } from '@/features/model-settings/useModels'
import { LogViewer } from '@/features/run-logs/LogViewer'
import { useLogExport } from '@/features/run-logs/useLogExport'
import { useRunLog } from '@/features/run-logs/useRunLog'
import type { FillStats } from '@/features/run-logs/useRunLog'
import { openResumeEditorPage } from '@/lib/tabs'
import { hasAnyFilledField } from '@/resume/schema'

const INITIAL_STATS: FillStats = { fieldCount: 0, mappedCount: 0, filledCount: 0 }

export function SidepanelApp() {
  const [activeTab, setActiveTab] = useState<'fill' | 'resume'>('fill')
  const [stats, setStats] = useState<FillStats>(INITIAL_STATS)
  const [status, setStatus] = useState<{ type: string; text: string }>({
    type: '',
    text: '等待开始',
  })
  const [settingsOpen, setSettingsOpen] = useState(false)

  const resumeApi = useResumeSlots()
  const modelsApi = useModels()

  const updateStatus = useCallback((type: string, text: string) => {
    setStatus({ type, text })
  }, [])

  const runLog = useRunLog({
    onStats: setStats,
    onError: (message) => {
      updateStatus('error', '错误')
      runLog.addLog('error', message)
    },
  })
  const logExport = useLogExport(runLog.addLog)

  const handleSessionEnd = useCallback(
    async (result: { status: string; stats?: Partial<FillStats>; errorMessage?: string }) => {
      const session = await runLog.finalizeFillSession(result)
      if (session) {
        await logExport.exportSession(session)
      }
    },
    [logExport, runLog]
  )

  const fillFlow = useFillFlow({
    resumeProfile: resumeApi.profile,
    onLog: runLog.addLog,
    onStats: setStats,
    onStatus: updateStatus,
    onSessionBegin: runLog.beginFillSession,
    onSessionEnd: handleSessionEnd,
    onRequireResume: () => setActiveTab('resume'),
    onRequireSettings: () => setSettingsOpen(true),
  })

  const hasResumeData = hasAnyFilledField(resumeApi.profile)

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
            title="模型设置"
            onClick={() => setSettingsOpen(true)}
          >
            <GearIcon width={19} height={19} />
          </button>
        </div>
      </header>

      <main className="op-main">
        <div className="op-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'fill'}
            className={`op-tab ${activeTab === 'fill' ? 'active' : ''}`}
            onClick={() => setActiveTab('fill')}
          >
            自动填充
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'resume'}
            className={`op-tab ${activeTab === 'resume' ? 'active' : ''}`}
            onClick={() => setActiveTab('resume')}
          >
            标准简历
          </button>
        </div>

        {activeTab === 'fill' ? (
          <FillPanel
            stats={stats}
            hasResumeData={hasResumeData}
            isFilling={fillFlow.isFilling}
            runningAction={fillFlow.runningAction}
            fillTip={fillFlow.fillTip}
            onRun={(actionKey: FillActionKey) => void fillFlow.runFill(actionKey)}
            onClearCache={() => void fillFlow.clearMappingCache()}
          />
        ) : (
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
                onCreate={() => void resumeApi.createNewSlot({ name: '新档位' })}
                onDuplicate={() => void resumeApi.createNewSlot({ name: '复制档位', copyFromId: resumeApi.activeSlotId })}
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
        )}

        <LogViewer
          logs={runLog.logs}
          onClear={runLog.clearLogs}
          exportState={logExport.state}
          selecting={logExport.selecting}
          onSelectDirectory={() => void logExport.selectDirectory()}
        />
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        modelsApi={modelsApi}
        onLog={runLog.addLog}
      />
    </div>
  )
}
