import DocIcon from '@/assets/icons/doc.svg'
import type { FillStats } from '@/features/run-logs/useFillEvents'
import { FILL_ACTIONS } from './useFillFlow'
import type { FillActionKey } from './useFillFlow'

interface FillPanelProps {
  stats: FillStats
  hasResumeData: boolean
  isFilling: boolean
  runningAction: FillActionKey | null
  fillTip: string | null
  onRun: (actionKey: FillActionKey) => void
  onCancel: () => void
  onClearCache: () => void
}

const ACTION_BUTTONS: Array<{ key: FillActionKey; className: string }> = [
  { key: 'overwritePage', className: 'op-btn op-btn-primary op-btn-lg' },
  { key: 'incrementalPage', className: 'op-btn op-btn-ghost op-btn-lg' },
  { key: 'selection', className: 'op-btn op-btn-ghost op-btn-lg' },
  { key: 'segmentedPage', className: 'op-btn op-btn-ghost op-btn-lg' },
]

export function FillPanel({
  stats,
  hasResumeData,
  isFilling,
  runningAction,
  fillTip,
  onRun,
  onCancel,
  onClearCache,
}: FillPanelProps) {
  return (
    <section className="op-panel active">
      <div className="op-stats">
        <div className="op-stat">
          <span className="op-stat-value">{stats.fieldCount}</span>
          <span className="op-stat-label">识别字段</span>
        </div>
        <div className="op-stat">
          <span className="op-stat-value">{stats.mappedCount}</span>
          <span className="op-stat-label">已映射</span>
        </div>
        <div className="op-stat">
          <span className="op-stat-value">{stats.filledCount}</span>
          <span className="op-stat-label">已填充</span>
        </div>
      </div>

      <div className="op-actions">
        {ACTION_BUTTONS.map(({ key, className }) => {
          const config = FILL_ACTIONS[key]
          const isCurrent = runningAction === key
          const label = !hasResumeData
            ? '请先填写标准简历'
            : isCurrent && isFilling
              ? config.runningText
              : config.triggerText

          return (
            <button
              key={key}
              className={className}
              disabled={!hasResumeData || isFilling}
              onClick={() => onRun(key)}
            >
              {key === 'overwritePage' ? <DocIcon width={18} height={18} /> : null}
              <span>{label}</span>
            </button>
          )
        })}
        {isFilling ? (
          <button className="op-btn op-btn-ghost op-btn-lg op-btn-stop" onClick={onCancel}>
            停止填充
          </button>
        ) : (
          <button className="op-btn op-btn-ghost op-btn-lg" onClick={onClearCache}>
            清理映射缓存
          </button>
        )}
        {fillTip ? <div className="op-hint">{fillTip}</div> : null}
      </div>
    </section>
  )
}
