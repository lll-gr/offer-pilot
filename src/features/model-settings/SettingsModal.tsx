import { useState } from 'react'

import PencilIcon from '@/assets/icons/pencil.svg'
import PlusIcon from '@/assets/icons/plus.svg'
import TrashIcon from '@/assets/icons/trash.svg'
import { Modal } from '@/components/Modal'
import type { ModelConfig } from '@/models/storage'
import { EditModelModal } from './EditModelModal'
import type { useModels } from './useModels'

type ModelsApi = ReturnType<typeof useModels>

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  modelsApi: ModelsApi
  onLog: (level: string, message: string) => void
}

export function SettingsModal({ open, onClose, modelsApi, onLog }: SettingsModalProps) {
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const openCreate = () => {
    setEditingModel(null)
    setEditOpen(true)
  }

  const openEdit = (model: ModelConfig) => {
    setEditingModel(model)
    setEditOpen(true)
  }

  const closeEdit = () => {
    setEditOpen(false)
    setEditingModel(null)
  }

  const handleItemClick = async (model: ModelConfig) => {
    await modelsApi.activateModel(model.id)
    onLog('success', `已切换模型：${model.name || model.id}`)
    onClose()
  }

  const handleDelete = async (model: ModelConfig) => {
    if (!window.confirm('确定要删除这个模型吗？')) return
    await modelsApi.deleteModel(model.id)
  }

  return (
    <Modal title="DeepSeek / OpenAI 兼容模型配置" open={open} onClose={onClose}>
      <div className="op-model-list">
        {modelsApi.models.map((model) => (
          <div
            key={model.id}
            className={`op-model-item ${model.id === modelsApi.activeModelId ? 'active' : ''}`}
            onClick={() => void handleItemClick(model)}
          >
            <input
              type="radio"
              name="activeModel"
              className="op-model-radio"
              checked={model.id === modelsApi.activeModelId}
              onChange={() => void handleItemClick(model)}
              onClick={(event) => event.stopPropagation()}
            />
            <div className="op-model-info">
              <div className="op-model-name">
                {model.name}
                {model.builtin ? <span className="op-model-badge">内置</span> : null}
              </div>
              <div className="op-model-meta">{model.model}</div>
            </div>
            <div className="op-model-actions" onClick={(event) => event.stopPropagation()}>
              <button className="op-icon-btn" title="编辑" onClick={() => openEdit(model)}>
                <PencilIcon width={15} height={15} />
              </button>
              {model.builtin ? null : (
                <button className="op-icon-btn" title="删除" onClick={() => void handleDelete(model)}>
                  <TrashIcon width={15} height={15} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button className="op-btn op-btn-ghost op-btn-block" onClick={openCreate}>
        <PlusIcon width={15} height={15} />
        <span>添加自定义模型</span>
      </button>

      <EditModelModal
        open={editOpen}
        onClose={closeEdit}
        editingModel={editingModel}
        saveModel={modelsApi.saveModel}
      />
    </Modal>
  )
}
