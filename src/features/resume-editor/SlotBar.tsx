/**
 * 简历档位切换条：档位下拉 + 新建/复制/删除 + 目标公司/职位输入。
 * 侧栏与全页编辑器共用。
 */

import { useState } from 'react'

import type { ResumeSlot } from '@/resume/profiles'

interface SlotBarProps {
  slots: ResumeSlot[]
  activeSlotId: string
  company: string
  position: string
  onSwitch: (slotId: string) => void
  onCreate: () => void
  onDuplicate: () => void
  onDelete: () => void
  onMetaChange: (meta: { company?: string; position?: string }) => void
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
}: SlotBarProps) {
  const [localCompany, setLocalCompany] = useState(company)
  const [localPosition, setLocalPosition] = useState(position)

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

  return (
    <div className="op-slotbar">
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
          <button className="op-btn op-btn-ghost op-btn-sm" onClick={onCreate} title="新建空档位">
            新建
          </button>
          <button className="op-btn op-btn-ghost op-btn-sm" onClick={onDuplicate} title="复制当前档位">
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
    </div>
  )
}
