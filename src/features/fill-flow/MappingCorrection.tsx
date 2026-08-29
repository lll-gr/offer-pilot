/**
 * 映射纠错：拉取最近一次填充的决策结果，逐条可改为正确的简历字段与动作，
 * 修正写回缓存——下次同结构表单直接命中正确决策。
 * 每行展示 action 徽标 / 置信度 / AI 理由（决策透明化）。
 */

import { useCallback, useEffect, useState } from 'react'

import { getFieldCatalog } from '@/resume/schema'
import { sendTabMessage } from '@/lib/tabs'

interface DecisionRow {
  fieldId: string
  fieldLabel: string
  resumePath: string
  reason: string
  action: string
  confidence: string
}

interface GetMappingsResponse {
  success: boolean
  session: {
    fields: { fieldId: string; label: string }[]
    mappings: { fieldId: string; resumePath: string; reason: string; action?: string; confidence?: string }[]
  } | null
}

interface CorrectMappingResponse {
  success: boolean
  message?: string
  /** 防线后实际生效的决策（controller 计算并回传，UI 只展示不计算） */
  decision?: { action?: string; resumePath?: string; reason?: string }
}

interface MappingCorrectionProps {
  onLog: (level: string, message: string) => void
  refreshKey: number
}

const ACTION_BADGES: Record<string, { label: string; className: string }> = {
  fill: { label: '填入', className: 'op-badge op-badge-info' },
  keep: { label: '保留', className: 'op-badge op-badge-ok' },
  correct: { label: '修正', className: 'op-badge op-badge-warn' },
  manual: { label: '人工', className: 'op-badge op-badge-warn' },
  skip: { label: '跳过', className: 'op-badge op-badge-muted' },
}

const ACTION_OPTIONS = [
  { value: 'fill', label: '填入' },
  { value: 'keep', label: '保留现值' },
  { value: 'correct', label: '修正现值' },
  { value: 'manual', label: '人工处理' },
  { value: 'skip', label: '跳过' },
]

const CONFIDENCE_LABELS: Record<string, string> = {
  high: '高把握',
  medium: '中把握',
  low: '低把握',
}

function actionBadge(action: string): { label: string; className: string } {
  return ACTION_BADGES[action] || ACTION_BADGES.fill
}

export function MappingCorrection({ onLog, refreshKey }: MappingCorrectionProps) {
  const [rows, setRows] = useState<DecisionRow[]>([])
  const [catalog, setCatalog] = useState<{ path: string; label: string }[]>([])
  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const loadMappings = useCallback(async () => {
    setCatalog(
      getFieldCatalog({ mode: 'max' })
        .filter((field) => field.hasValue)
        .map((field) => ({ path: field.path, label: `${field.sectionLabel} · ${field.label}` })),
    )

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tabId = tabs[0]?.id
    if (!tabId) return

    const response = await sendTabMessage<GetMappingsResponse>(tabId, { action: 'getMappings' }).catch(() => null)
    if (response?.success && response.session) {
      const labelById = new Map(response.session.fields.map((f) => [f.fieldId, f.label || f.fieldId]))
      setRows(
        response.session.mappings.map((m) => ({
          fieldId: m.fieldId,
          fieldLabel: labelById.get(m.fieldId) || m.fieldId,
          resumePath: m.resumePath || '',
          reason: m.reason || '',
          action: m.action || 'fill',
          confidence: m.confidence || 'medium',
        })),
      )
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (refreshKey > 0) {
      void loadMappings()
    }
  }, [refreshKey, loadMappings])

  if (!loaded || rows.length === 0) {
    return null
  }

  const correct = async (fieldId: string, resumePath: string, action: string) => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tabId = tabs[0]?.id
    if (!tabId) return

    const response = await sendTabMessage<CorrectMappingResponse>(tabId, {
      action: 'correctMapping',
      fieldId,
      resumePath,
      actionOverride: action,
    }).catch(() => null)

    if (response?.success) {
      const effective = response.decision
      setRows((prev) =>
        prev.map((row) =>
          row.fieldId === fieldId
            ? {
                ...row,
                resumePath: effective?.resumePath ?? resumePath,
                action: effective?.action ?? action,
                reason: effective?.reason ?? row.reason,
              }
            : row,
        ),
      )
      // 防线降级时提示用户（如敏感字段被强制 manual）
      if (effective && effective.action !== action) {
        onLog('warning', `「${fieldId}」的动作已按本地防线调整为 ${effective.action}`)
      } else {
        onLog('success', '决策已修正并写入缓存，重新填充即生效')
      }
    } else {
      onLog('error', `决策修正失败：${response?.message || '未知错误'}`)
    }
  }

  return (
    <div className="op-mapping-fix">
      <button className="op-btn-text" onClick={() => setExpanded((prev) => !prev)}>
        {expanded ? '收起映射结果' : `查看/修正映射（${rows.length} 条）`}
      </button>

      {expanded ? (
        <div className="op-mapping-fix-list">
          {rows.map((row) => {
            const badge = actionBadge(row.action)
            return (
              <div className="op-mapping-fix-row" key={row.fieldId}>
                <div className="op-mapping-fix-head">
                  <span className={badge.className}>{badge.label}</span>
                  {row.confidence in CONFIDENCE_LABELS ? (
                    <span className="op-badge op-badge-muted">{CONFIDENCE_LABELS[row.confidence]}</span>
                  ) : null}
                  <span className="op-mapping-fix-field" title={row.fieldLabel}>
                    {row.fieldLabel}
                  </span>
                </div>
                {row.reason ? <div className="op-mapping-fix-reason" title={row.reason}>{row.reason}</div> : null}
                <div className="op-mapping-fix-edit">
                  <select
                    className="op-ctrl-select"
                    value={row.resumePath}
                    onChange={(event) => void correct(row.fieldId, event.target.value, row.action)}
                  >
                    <option value="">（不映射）</option>
                    {catalog.map((field) => (
                      <option key={field.path} value={field.path}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="op-ctrl-select op-ctrl-select-action"
                    value={row.action}
                    onChange={(event) => void correct(row.fieldId, row.resumePath, event.target.value)}
                  >
                    {ACTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
