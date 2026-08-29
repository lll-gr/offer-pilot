import { useEffect, useRef } from 'react'

import type { LogExportState } from './useLogExport'
import type { LogItem } from './useFillEvents'

interface LogViewerProps {
  logs: LogItem[]
  onClear: () => void
  exportState: LogExportState
  selecting: boolean
  onSelectDirectory: () => void
}

export function LogViewer({ logs, onClear, exportState, selecting, onSelectDirectory }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [logs])

  return (
    <div className="op-log">
      <div className="op-section-header">
        <span>运行日志</span>
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
        {logs.map((log) => (
          <div key={log.id} className={`op-log-item op-log-level-${log.level}`}>
            <span className="op-log-time">{log.time}</span>
            <span className="op-log-msg">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
