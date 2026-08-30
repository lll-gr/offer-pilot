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
  isBackfilling: boolean
  onRun: (actionKey: FillActionKey) => void
  onCancel: () => void
  onClearCache: () => void
  onRequireResume: () => void
  onBackfill: () => void
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
  isBackfilling,
  onRun,
  onCancel,
  onClearCache,
  onRequireResume,
  onBackfill,
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

      {!hasResumeData ? (
        <button className="op-empty-resume" onClick={onRequireResume}>
          <span className="op-empty-resume-title">还没有标准简历</span>
          <span className="op-empty-resume-action">去填写 →</span>
        </button>
      ) : null}

      <div className="op-actions">
        {ACTION_BUTTONS.map(({ key, className }) => {
          const config = FILL_ACTIONS[key]
          const isCurrent = runningAction === key

          return (
            <button
              key={key}
              className={className}
              disabled={!hasResumeData || isFilling}
              onClick={() => onRun(key)}
            >
              {key === 'overwritePage' ? <DocIcon width={18} height={18} /> : null}
              <span>{isCurrent && isFilling ? config.runningText : config.triggerText}</span>
            </button>
          )
        })}
        {isFilling || isBackfilling ? (
          <button className="op-btn op-btn-ghost op-btn-lg op-btn-stop" onClick={onCancel}>
            停止填充
          </button>
        ) : (
          <button className="op-btn op-btn-ghost op-btn-lg" onClick={onClearCache}>
            清理映射缓存
          </button>
        )}
        <button
          className="op-btn op-btn-ghost op-btn-lg"
          disabled={isFilling || isBackfilling}
          onClick={onBackfill}
          title="扫描当前页面已填的内容，补充到标准简历的空缺字段（不覆盖已有内容）"
        >
          {isBackfilling ? '回填中...' : '回填简历'}
        </button>
        {fillTip ? <div className="op-hint">{fillTip}</div> : null}
      </div>
    </section>
  )
}
