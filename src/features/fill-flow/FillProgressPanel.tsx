/**
 * 填充实时进度：FillEvent 事件流驱动的状态机（观察者模式）。
 * phase 覆盖全生命周期（选区/扫描/规划/AI 批次/执行），fieldProgress 逐字段落定。
 * 归约器为纯函数，面板渲染派生状态。
 */

import type { FieldProgressEvent, FieldProgressStatus, FillPhase } from '@/messaging/events'

export interface FieldProgressState {
  phase: FillPhase | 'idle'
  /** aiBatch 阶段的批次进度 */
  batch: { current: number; total: number } | null
  total: number
  processed: number
  filled: number
  kept: number
  manual: number
  skipped: number
  failed: number
  current: { fieldId: string; label: string } | null
  /** 最近落定的字段（新→旧，最多 8 条） */
  recent: Array<{ fieldId: string; label: string; status: FieldProgressStatus }>
}

export const INITIAL_FIELD_PROGRESS: FieldProgressState = {
  phase: 'idle',
  batch: null,
  total: 0,
  processed: 0,
  filled: 0,
  kept: 0,
  manual: 0,
  skipped: 0,
  failed: 0,
  current: null,
  recent: [],
}

type ProgressInput = FieldProgressEvent | { type: 'phase'; phase: FillPhase; batch?: number; batches?: number }

/** 单个事件归约进状态（纯函数，可单测） */
export function reduceFieldProgress(
  state: FieldProgressState,
  event: ProgressInput
): FieldProgressState {
  if (event.type === 'phase') {
    return {
      ...state,
      phase: event.phase,
      batch: event.batch && event.batches ? { current: event.batch, total: event.batches } : null,
    }
  }

  const next: FieldProgressState = {
    ...state,
    total: event.total || state.total,
    current: { fieldId: event.fieldId, label: event.label },
  }

  if (event.status === 'pending') {
    return next
  }

  const key = event.status as 'filled' | 'kept' | 'manual' | 'skipped' | 'failed'
  next[key] = (next[key] || 0) + 1
  next.processed = (next.processed || 0) + 1

  const dedupedRecent = state.recent.filter((item) => item.fieldId !== event.fieldId)
  next.recent = [{ fieldId: event.fieldId, label: event.label, status: event.status }, ...dedupedRecent].slice(0, 8)
  return next
}

const PHASE_LABELS: Record<FillPhase | 'idle', string> = {
  idle: '准备中',
  selection: '等待页面选区',
  expanding: '探索页面区块',
  scanning: '扫描表单字段',
  planning: '生成填充计划',
  aiBatch: 'AI 规划中',
  executing: '执行填充',
}

const STATUS_META: Record<FieldProgressStatus, { label: string; className: string }> = {
  pending: { label: '处理中', className: 'op-badge op-badge-info' },
  filled: { label: '已填', className: 'op-badge op-badge-ok' },
  kept: { label: '保留', className: 'op-badge op-badge-ok' },
  manual: { label: '人工', className: 'op-badge op-badge-warn' },
  skipped: { label: '跳过', className: 'op-badge op-badge-muted' },
  failed: { label: '失败', className: 'op-badge op-badge-danger' },
}

interface FillProgressPanelProps {
  progress: FieldProgressState
}

export function FillProgressPanel({ progress }: FillProgressPanelProps) {
  const phaseLabel = PHASE_LABELS[progress.phase]
  const batchLabel =
    progress.phase === 'aiBatch' && progress.batch
      ? `（批次 ${progress.batch.current}/${progress.batch.total}）`
      : ''
  const percent =
    progress.phase === 'executing' && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : progress.phase === 'aiBatch' && progress.batch
        ? Math.round((progress.batch.current / progress.batch.total) * 100)
        : 0

  return (
    <div className="op-fill-progress">
      <div className="op-fill-progress-header">
        <span>
          {phaseLabel}
          {batchLabel}
        </span>
        {progress.phase === 'executing' ? (
          <span className="op-fill-progress-counts">
            {progress.processed}/{progress.total}
            {progress.filled > 0 ? ` · 已填 ${progress.filled}` : ''}
            {progress.manual > 0 ? ` · 人工 ${progress.manual}` : ''}
            {progress.failed > 0 ? ` · 失败 ${progress.failed}` : ''}
            {progress.kept > 0 ? ` · 保留 ${progress.kept}` : ''}
            {progress.skipped > 0 ? ` · 跳过 ${progress.skipped}` : ''}
          </span>
        ) : null}
      </div>

      <div className="op-fill-progress-bar">
        <div className="op-fill-progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>

      {progress.current && progress.phase === 'executing' ? (
        <div className="op-fill-progress-current">
          <span className="op-badge op-badge-info">处理中</span>
          <span className="op-fill-progress-field" title={progress.current.label}>
            {progress.current.label}
          </span>
        </div>
      ) : null}

      {progress.recent.length > 0 && progress.phase === 'executing' ? (
        <div className="op-fill-progress-recent">
          {progress.recent.map((item) => {
            const meta = STATUS_META[item.status]
            return (
              <div className="op-fill-report-row" key={item.fieldId}>
                <span className={meta.className}>{meta.label}</span>
                <span className="op-fill-report-field" title={item.label}>
                  {item.label}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
