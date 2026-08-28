import type { ReactNode } from 'react'

/**
 * 模态框壳：两个设置弹窗共用。
 */

interface ModalProps {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ title, open, onClose, children, footer }: ModalProps) {
  if (!open) return null

  return (
    <div className="op-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="op-modal-backdrop" onClick={onClose} />
      <div className="op-modal-content">
        <div className="op-modal-header">
          <h3>{title}</h3>
          <button className="op-icon-btn" onClick={onClose} title="关闭">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="op-modal-body">{children}</div>
        {footer ? <div className="op-modal-footer">{footer}</div> : null}
      </div>
    </div>
  )
}
