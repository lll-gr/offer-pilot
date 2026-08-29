/**
 * 侧栏设置面板：主界面「自动填充/标准简历」之外的第三态——
 * 分区导航（模型/填充行为/缓存/红线）+ 内容区，侧栏内切换不跳页。
 */

import { useCallback, useEffect, useState } from 'react'

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/settings/storage'
import type { FillSettings } from '@/settings/storage'
import { CacheManager } from '@/features/fill-flow/CacheManager'
import { ModelsPanel } from './ModelsPanel'
import { FillBehaviorPanel } from './FillBehaviorPanel'

type SectionKey = 'models' | 'behavior' | 'cache' | 'about'

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: 'models', label: '模型' },
  { key: 'behavior', label: '填充行为' },
  { key: 'cache', label: '缓存' },
  { key: 'about', label: '红线·关于' },
]

interface SettingsPanelProps {
  onBack: () => void
  onLog: (level: string, message: string) => void
}

export function SettingsPanel({ onBack, onLog }: SettingsPanelProps) {
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
      <div className="op-settings-back">
        <button className="op-btn-text" onClick={onBack}>
          ← 返回填充
        </button>
        {settingsStatus && section === 'behavior' ? (
          <span className="op-settings-status">{settingsStatus}</span>
        ) : null}
      </div>

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

      {section === 'models' ? <ModelsPanel onLog={onLog} /> : null}
      {section === 'behavior' ? (
        <FillBehaviorPanel settings={settings} onChange={updateSetting} onReset={resetSettings} />
      ) : null}
      {section === 'cache' ? <CacheManager onLog={onLog} /> : null}
      {section === 'about' ? <AboutPanel /> : null}
    </>
  )
}

function AboutPanel() {
  const version = chrome.runtime.getManifest().version

  return (
    <section className="op-panel active">
      <div className="op-settings-section">
        <div className="op-settings-section-header">安全红线（不可配置）</div>
        <div className="op-redline-list">
          <div className="op-redline-item">
            <strong>永不自动提交表单</strong>
            <p>插件只填写内容，最终「提交/投递」永远由你点击。这是底线，不提供开关。</p>
          </div>
          <div className="op-redline-item">
            <strong>敏感字段强制人工</strong>
            <p>身份证件号、政治面貌、银行卡、社保、紧急联系人等一律跳过自动填充，交由人工确认。</p>
          </div>
          <div className="op-redline-item">
            <strong>数据不出本地</strong>
            <p>简历、Key、缓存全存本地；仅填充时把表单结构与简历预览发给你自己配置的模型。</p>
          </div>
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
