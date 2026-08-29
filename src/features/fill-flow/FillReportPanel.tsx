/**
 * 填充报告：最近一次填充中需要用户注意的字段清单。
 * manual（敏感/低置信度）→ 需人工处理；failed → 填充失败；
 * kept → 已保留现值；filled 未验证 → 写入但未读回验证。
 */

import type { FillFieldReport } from '@/messaging/bridge'

interface FillReportPanelProps {
  report: FillFieldReport[]
}

const OUTCOME_META: Record<FillFieldReport['outcome'], { label: string; className: string }> = {
  manual: { label: '需人工', className: 'op-badge op-badge-warn' },
  failed: { label: '失败', className: 'op-badge op-badge-danger' },
  kept: { label: '已保留', className: 'op-badge op-badge-ok' },
  filled: { label: '未验证', className: 'op-badge op-badge-muted' },
  skipped: { label: '跳过', className: 'op-badge op-badge-muted' },
}

const OUTCOME_ORDER: FillFieldReport['outcome'][] = ['manual', 'failed', 'filled', 'kept', 'skipped']

export function FillReportPanel({ report }: FillReportPanelProps) {
  if (report.length === 0) return null

  const sorted = [...report].sort(
    (left, right) => OUTCOME_ORDER.indexOf(left.outcome) - OUTCOME_ORDER.indexOf(right.outcome),
  )

  const counts = OUTCOME_ORDER.filter((outcome) => report.some((item) => item.outcome === outcome))
    .map((outcome) => {
      const count = report.filter((item) => item.outcome === outcome).length
      return `${OUTCOME_META[outcome].label} ${count}`
    })
    .join(' · ')

  return (
    <div className="op-fill-report">
      <div className="op-fill-report-header">
        <span>填充报告</span>
        <span className="op-fill-report-counts">{counts}</span>
      </div>
      <div className="op-fill-report-list">
        {sorted.map((item) => {
          const meta = OUTCOME_META[item.outcome]
          return (
            <div className="op-fill-report-row" key={item.fieldId}>
              <span className={meta.className}>{meta.label}</span>
              <span className="op-fill-report-field" title={item.label}>
                {item.label}
              </span>
              {item.message ? (
                <span className="op-fill-report-message" title={item.message}>
                  {item.message}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
