/**
 * 简历档位切换条：档位下拉 + 新建/复制/删除（弹窗命名）+ 目标公司/职位输入。
 * 侧栏与全页编辑器共用。
 */

import { useState } from 'react'

import { Modal } from '@/components/Modal'
import type { ResumeSlot } from '@/resume/profiles'

interface SlotBarProps {
  slots: ResumeSlot[]
  activeSlotId: string
  company: string
  position: string
  onSwitch: (slotId: string) => void
  onCreate: (options: { name?: string }) => void
  onDuplicate: (options: { name?: string; copyFromId?: string }) => void
  onDelete: () => void
  onMetaChange: (meta: { company?: string; position?: string }) => void
  /** 紧凑模式：只渲染档位行（与导入区同行时用），公司/职位由外部单独渲染 */
  compact?: boolean
}

export function SlotBar({
  slots,
  activeSlotId,
  company,
  position,
  onSwitch,
  onCreate,
  onDuplicate,
  onDelete,
  onMetaChange,
  compact,
}: SlotBarProps) {
  const [localCompany, setLocalCompany] = useState(company)
  const [localPosition, setLocalPosition] = useState(position)
  // 新建/复制弹窗：mode 为空表示关闭
  const [dialog, setDialog] = useState<{ mode: 'create' | 'duplicate' } | null>(null)
  const [dialogName, setDialogName] = useState('')

  // 外部切档后同步输入框
  const activeKey = activeSlotId
  const [lastSyncedKey, setLastSyncedKey] = useState(activeKey)
  if (lastSyncedKey !== activeKey) {
    setLastSyncedKey(activeKey)
    setLocalCompany(company)
    setLocalPosition(position)
  }

  const commitCompany = () => {
    if (localCompany !== company) onMetaChange({ company: localCompany })
  }
  const commitPosition = () => {
    if (localPosition !== position) onMetaChange({ position: localPosition })
  }

  const openCreate = () => {
    setDialogName('新档位')
    setDialog({ mode: 'create' })
  }

  const openDuplicate = () => {
    const active = slots.find((slot) => slot.id === activeSlotId)
    setDialogName(active ? `复制 · ${active.name}` : '复制档位')
    setDialog({ mode: 'duplicate' })
  }

  const confirmDialog = () => {
    if (!dialog) return
    const name = dialogName.trim()
    if (dialog.mode === 'create') {
      onCreate({ name: name || '新档位' })
    } else {
      onDuplicate({ name: name || '复制档位', copyFromId: activeSlotId })
    }
    setDialog(null)
  }

  return (
    <div className={`op-slotbar ${compact ? 'op-slotbar-compact' : ''}`}>
      <div className="op-slotbar-row">
        <div className="op-field op-slotbar-select-group">
          <label htmlFor="resumeSlotSelect">简历档位</label>
          <select
            id="resumeSlotSelect"
            value={activeSlotId}
            onChange={(event) => onSwitch(event.target.value)}
          >
            {slots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.name}
              </option>
            ))}
          </select>
        </div>
        <div className="op-slotbar-actions">
          <button className="op-btn op-btn-ghost op-btn-sm" onClick={openCreate} title="新建空档位">
            新建
          </button>
          <button className="op-btn op-btn-ghost op-btn-sm" onClick={openDuplicate} title="复制当前档位">
            复制
          </button>
          <button
            className="op-btn op-btn-ghost op-btn-sm"
            onClick={onDelete}
            disabled={slots.length <= 1}
            title={slots.length <= 1 ? '至少保留一个档位' : '删除当前档位'}
          >
            删除
          </button>
        </div>
      </div>

      {compact ? null : (
        <div className="op-slotbar-row">
          <div className="op-field op-slotbar-meta-group">
            <label htmlFor="slotCompany">目标公司</label>
            <input
              id="slotCompany"
              type="text"
              placeholder="如：字节跳动（可选）"
              value={localCompany}
              onChange={(event) => setLocalCompany(event.target.value)}
              onBlur={commitCompany}
            />
          </div>
          <div className="op-field op-slotbar-meta-group">
            <label htmlFor="slotPosition">目标职位</label>
            <input
              id="slotPosition"
              type="text"
              placeholder="如：后端开发工程师（可选）"
              value={localPosition}
              onChange={(event) => setLocalPosition(event.target.value)}
              onBlur={commitPosition}
            />
          </div>
        </div>
      )}

      <Modal
        title={dialog?.mode === 'duplicate' ? '复制简历档位' : '新建简历档位'}
        open={dialog !== null}
        onClose={() => setDialog(null)}
        footer={
          <button className="op-btn op-btn-primary op-btn-block" onClick={confirmDialog}>
            {dialog?.mode === 'duplicate' ? '创建副本' : '创建'}
          </button>
        }
      >
        <div className="op-field">
          <label htmlFor="slotNameInput">档位名称</label>
          <input
            id="slotNameInput"
            type="text"
            autoFocus
            value={dialogName}
            placeholder={dialog?.mode === 'duplicate' ? '复制 · 当前档位名' : '如：投递字节 · 后端'}
            onChange={(event) => setDialogName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') confirmDialog()
            }}
          />
        </div>
      </Modal>
    </div>
  )
}
