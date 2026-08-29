/**
 * 侧栏设置 · 模型区：列表激活/编辑/删除 + 添加弹窗（含测试连接）。
 */

import { useState } from 'react'

import PencilIcon from '@/assets/icons/pencil.svg'
import PlusIcon from '@/assets/icons/plus.svg'
import TrashIcon from '@/assets/icons/trash.svg'
import type { ModelConfig } from '@/models/storage'
import { EditModelModal } from './EditModelModal'
import { useModels } from './useModels'

interface ModelsPanelProps {
  onLog: (level: string, message: string) => void
}

export function ModelsPanel({ onLog }: ModelsPanelProps) {
  const modelsApi = useModels()
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

  const handleActivate = async (model: ModelConfig) => {
    await modelsApi.activateModel(model.id)
    onLog('success', `已激活模型：${model.name}`)
  }

  const handleDelete = async (model: ModelConfig) => {
    if (!window.confirm(`确定要删除模型「${model.name}」吗？`)) return
    await modelsApi.deleteModel(model.id)
    onLog('info', `已删除模型：${model.name}`)
  }

  return (
    <section className="op-panel active">
      <div className="op-settings-section">
        <div className="op-settings-section-header">模型配置</div>
        <p className="op-settings-section-desc">
          DeepSeek / OpenAI 兼容接口；点选激活，编辑内可测试连接。
        </p>

        <div className="op-model-list">
          {modelsApi.models.length === 0 ? (
            <div className="op-model-empty">还没有模型配置，添加一个后即可使用 AI 功能。</div>
          ) : null}
          {modelsApi.models.map((model) => (
            <div
              key={model.id}
              className={`op-model-item ${model.id === modelsApi.activeModelId ? 'active' : ''}`}
              onClick={() => void handleActivate(model)}
            >
              <input
                type="radio"
                name="activeModel"
                className="op-model-radio"
                checked={model.id === modelsApi.activeModelId}
                onChange={() => void handleActivate(model)}
                onClick={(event) => event.stopPropagation()}
              />
              <div className="op-model-info">
                <div className="op-model-name">{model.name}</div>
                <div className="op-model-meta">
                  {model.model}
                  {model.apiKey ? '' : ' · 缺 Key'}
                </div>
              </div>
              <div className="op-model-actions" onClick={(event) => event.stopPropagation()}>
                <button className="op-icon-btn" title="编辑" onClick={() => openEdit(model)}>
                  <PencilIcon width={15} height={15} />
                </button>
                <button className="op-icon-btn" title="删除" onClick={() => void handleDelete(model)}>
                  <TrashIcon width={15} height={15} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <button className="op-btn op-btn-ghost op-btn-block" onClick={openCreate}>
          <PlusIcon width={15} height={15} />
          <span>添加模型</span>
        </button>
      </div>

      <EditModelModal
        open={editOpen}
        onClose={closeEdit}
        editingModel={editingModel}
        saveModel={modelsApi.saveModel}
        createDefaults={modelsApi.createDefaults}
      />
    </section>
  )
}
