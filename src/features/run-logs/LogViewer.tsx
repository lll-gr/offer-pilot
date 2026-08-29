import { useEffect, useRef } from 'react'

import type { LogExportState } from './useLogExport'
import type { LogItem } from './useFillEvents'

interface LogViewerProps {
  logs: LogItem[]
  onClear: () => void
  exportState: LogExportState
  selecting: boolean
  onSelectDirectory: () => void
  /** Modal 内嵌模式：去掉外层卡片壳（标题/边距由 Modal 提供） */
  embedded?: boolean
}

export function LogViewer({ logs, onClear, exportState, selecting, onSelectDirectory, embedded }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [logs])

  const body = (
    <>
      <div className="op-section-header">
        <span>{embedded ? '操作' : '运行日志'}</span>
        <div className="op-section-actions">
          <button
            className="op-btn-text"
            disabled={!exportState.supported || selecting}
            onClick={onSelectDirectory}
          >
            {exportState.buttonLabel}
          </button>
          <button className="op-btn-text" onClick={onClear}>
            清空
          </button>
        </div>
      </div>
      <div className="op-hint">{exportState.statusText}</div>
      <div className="op-log-list" ref={containerRef}>
        {logs.length === 0 ? (
          <div className="op-log-empty">还没有日志。发起一次自动填充后，过程记录会出现在这里。</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className={`op-log-item op-log-level-${log.level}`}>
              <span className="op-log-time">{log.time}</span>
              <span className="op-log-msg">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </>
  )

  if (embedded) {
    return <div className="op-log op-log-embedded">{body}</div>
  }

  return <div className="op-log">{body}</div>
}
