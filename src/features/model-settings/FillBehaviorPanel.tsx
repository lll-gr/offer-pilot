/**
 * 侧栏设置 · 填充行为区：调参表单（保存即生效），纵向排列适配窄栏。
 */

import type { FillSettings } from '@/settings/storage'

interface FieldDef {
  key: keyof FillSettings
  label: string
  desc: string
  unit?: string
  min: number
  max: number
  step?: number
}

const FIELDS: FieldDef[] = [
  { key: 'segmentMaxRounds', label: '分步填充最大轮数', desc: '防异常页面无限循环（1-100）', min: 1, max: 100 },
  { key: 'aiBatchSize', label: 'AI 规划分批大小', desc: '单次调用字段数上限，大表单分批（5-100）', min: 5, max: 100 },
  { key: 'fillRetryCount', label: '填充失败重试次数', desc: '写入/验证失败后自动重试（0-3）', min: 0, max: 3 },
  { key: 'deepScanMaxRounds', label: '深度扫描展开轮数', desc: '填充前展开「展开更多」的轮数，0=不展开（0-20）', min: 0, max: 20 },
  {
    key: 'highlightAutoClearMs',
    label: '填充高亮清除延时',
    desc: '已填字段高亮消失时间，0=常显（毫秒）',
    unit: 'ms',
    min: 0,
    max: 60_000,
    step: 500,
  },
  {
    key: 'requestTimeoutMs',
    label: 'AI 请求超时',
    desc: '单次模型调用最长等待（毫秒）',
    unit: 'ms',
    min: 10_000,
    max: 600_000,
    step: 5000,
  },
  { key: 'cacheMaxEntries', label: '决策缓存上限', desc: '按页面保留条目数，LRU 淘汰（5-500）', min: 5, max: 500 },
]

interface FillBehaviorPanelProps {
  settings: FillSettings
  onChange: (patch: Partial<FillSettings>) => void
  onReset: () => void
}

export function FillBehaviorPanel({ settings, onChange, onReset }: FillBehaviorPanelProps) {
  return (
    <section className="op-panel active">
      <div className="op-settings-section">
        <div className="op-settings-section-header">
          填充行为
          <button className="op-btn op-btn-ghost op-btn-sm" onClick={onReset}>
            恢复默认
          </button>
        </div>
        <p className="op-settings-section-desc">改完立即生效，无需重启；不确定含义保持默认即可。</p>

        <div className="op-settings-form">
          {FIELDS.map((field) => (
            <div className="op-settings-field" key={field.key}>
              <div className="op-settings-field-copy">
                <label htmlFor={`setting-${field.key}`}>{field.label}</label>
                <p>{field.desc}</p>
              </div>
              <div className="op-settings-field-input">
                <input
                  id={`setting-${field.key}`}
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step || 1}
                  value={settings[field.key]}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      onChange({ [field.key]: value })
                    }
                  }}
                />
                {field.unit ? <span className="op-settings-field-unit">{field.unit}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
