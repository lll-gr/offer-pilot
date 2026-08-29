/**
 * 侧栏设置面板：主界面「自动填充/标准简历」之外的第三态——
 * 分区导航（模型/填充行为/缓存/红线）+ 内容区，侧栏内切换不跳页。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/settings/storage'
import type { FillSettings } from '@/settings/storage'
import { CacheManager } from '@/features/fill-flow/CacheManager'
import type { LogItem } from '@/features/run-logs/useFillEvents'
import type { useLogExport } from '@/features/run-logs/useLogExport'
import { LogViewer } from '@/features/run-logs/LogViewer'
import {
  downloadConfigFile,
  exportConfig,
  importConfig,
  parseImportedConfig,
} from '@/settings/transfer'
import { ModelsPanel } from './ModelsPanel'
import { FillBehaviorPanel } from './FillBehaviorPanel'

type SectionKey = 'models' | 'behavior' | 'cache' | 'logs' | 'about'

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: 'models', label: '模型' },
  { key: 'behavior', label: '填充行为' },
  { key: 'cache', label: '缓存' },
  { key: 'logs', label: '运行日志' },
  { key: 'about', label: '关于' },
]

interface SettingsPanelProps {
  onLog: (level: string, message: string) => void
  logs: LogItem[]
  onClearLogs: () => void
  logExport: ReturnType<typeof useLogExport>
}

export function SettingsPanel({ onLog, logs, onClearLogs, logExport }: SettingsPanelProps) {
  const [section, setSection] = useState<SectionKey>('models')
  const [settings, setSettings] = useState<FillSettings>({ ...DEFAULT_SETTINGS })
  const [settingsStatus, setSettingsStatus] = useState('')

  useEffect(() => {
    void loadSettings().then(setSettings)
  }, [])

  const updateSetting = useCallback(
    async (patch: Partial<FillSettings>) => {
      const next = { ...settings, ...patch }
      setSettings(next)
      const saved = await saveSettings(next)
      setSettings(saved)
      setSettingsStatus('已保存，立即生效')
      window.setTimeout(() => setSettingsStatus(''), 2000)
    },
    [settings]
  )

  const resetSettings = useCallback(async () => {
    const saved = await saveSettings({ ...DEFAULT_SETTINGS })
    setSettings(saved)
    setSettingsStatus('已恢复默认值')
    window.setTimeout(() => setSettingsStatus(''), 2000)
  }, [])

  return (
    <>
      <div className="op-settings-nav">
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`op-settings-nav-btn ${section === item.key ? 'active' : ''}`}
            onClick={() => setSection(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {settingsStatus && section === 'behavior' ? (
        <div className="op-settings-status">{settingsStatus}</div>
      ) : null}

      {section === 'models' ? <ModelsPanel onLog={onLog} /> : null}
      {section === 'behavior' ? (
        <FillBehaviorPanel settings={settings} onChange={updateSetting} onReset={resetSettings} />
      ) : null}
      {section === 'cache' ? (
        <section className="op-panel active">
          <div className="op-settings-section">
            <div className="op-settings-section-header">映射缓存</div>
            <p className="op-settings-section-desc">
              填充决策（字段映射 + 动作）按页面缓存，命中即跳过 AI 调用；纠错后的决策也会写入。
            </p>
            <CacheManager onLog={onLog} />
          </div>
        </section>
      ) : null}
      {section === 'logs' ? (
        <section className="op-panel active">
          <div className="op-settings-section">
            <div className="op-settings-section-header">运行日志</div>
            <p className="op-settings-section-desc">填充过程与 AI 决策的完整记录，可导出到本地目录留存。</p>
            <LogViewer
              logs={logs}
              onClear={onClearLogs}
              exportState={logExport.state}
              selecting={logExport.selecting}
              onSelectDirectory={() => void logExport.selectDirectory()}
              embedded
            />
          </div>
        </section>
      ) : null}
      {section === 'about' ? <AboutPanel onLog={onLog} /> : null}
    </>
  )
}

function AboutPanel({ onLog }: { onLog: (level: string, message: string) => void }) {
  const version = chrome.runtime.getManifest().version
  const importInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const handleExport = async () => {
    setBusy(true)
    try {
      const config = await exportConfig()
      downloadConfigFile(config)
      onLog('success', `已导出配置（${config.data.models.length} 个模型 · ${config.data.resumeSlots.length} 个简历档位）`)
    } catch (error) {
      onLog('error', `导出失败：${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (importInputRef.current) importInputRef.current.value = ''
    if (!file) return

    if (!window.confirm('导入将覆盖当前的模型配置、全部简历档位与应用设置，确定继续？')) return

    setBusy(true)
    try {
      const text = await file.text()
      const config = parseImportedConfig(text)
      const result = await importConfig(config)
      onLog('success', `导入完成：${result.modelCount} 个模型 · ${result.slotCount} 个简历档位`)
    } catch (error) {
      onLog('error', `导入失败：${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="op-panel active">
      <div className="op-settings-section">
        <div className="op-settings-section-header">配置备份</div>
        <p className="op-settings-section-desc">
          导出模型配置（含 API Key）、全部简历档位与应用设置为 JSON 文件；换机或重装后导入即可恢复。
        </p>
        <div className="op-settings-transfer-actions">
          <button className="op-btn op-btn-ghost" disabled={busy} onClick={() => void handleExport()}>
            导出配置
          </button>
          <button
            className="op-btn op-btn-ghost"
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
          >
            导入配置
          </button>
          <input ref={importInputRef} type="file" accept="application/json" hidden onChange={(event) => void handleImportFile(event)} />
        </div>
      </div>

      <div className="op-settings-section">
        <div className="op-settings-section-header">关于</div>
        <p className="op-settings-section-desc">
          Offer Pilot v{version}
          <br />
          <a
            href="https://github.com/lll-gr/offer-pilot"
            target="_blank"
            rel="noreferrer"
            className="op-settings-link"
          >
            GitHub 仓库
          </a>
          {' · '}
          <a
            href="https://github.com/lll-gr/offer-pilot/releases"
            target="_blank"
            rel="noreferrer"
            className="op-settings-link"
          >
            更新日志
          </a>
        </p>
      </div>
    </section>
  )
}
