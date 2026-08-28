import { useEffect, useState } from 'react'

import EyeIcon from '@/assets/icons/eye.svg'
import { Modal } from '@/components/Modal'
import type { ModelConfig } from '@/models/storage'
import type { ModelFormValues } from './useModels'

interface EditModelModalProps {
  open: boolean
  onClose: () => void
  editingModel: ModelConfig | null
  saveModel: (editingModelId: string | null, values: ModelFormValues) => Promise<void>
}

const CREATE_DEFAULTS: ModelFormValues = {
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
}

export function EditModelModal({ open, onClose, editingModel, saveModel }: EditModelModalProps) {
  const [form, setForm] = useState<ModelFormValues>(CREATE_DEFAULTS)
  const [status, setStatus] = useState<{ type: string; message: string }>({ type: '', message: '' })
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  useEffect(() => {
    if (!open) return
    setStatus({ type: '', message: '' })
    if (editingModel) {
      setForm({
        name: editingModel.name,
        baseUrl: editingModel.baseUrl,
        apiKey: editingModel.apiKey,
        model: editingModel.model,
      })
    } else {
      setForm(CREATE_DEFAULTS)
    }
  }, [open, editingModel])

  const update = (key: keyof ModelFormValues) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveModel(editingModel?.id ?? null, form)
      setStatus({ type: 'success', message: '保存成功' })
      window.setTimeout(onClose, 300)
    } catch (error) {
      setStatus({ type: 'error', message: `保存失败：${(error as Error).message}` })
    } finally {
      window.setTimeout(() => setSaving(false), 300)
    }
  }

  return (
    <Modal
      title={editingModel ? '编辑模型' : '添加模型'}
      open={open}
      onClose={onClose}
      footer={
        <button className="op-btn op-btn-primary op-btn-block" disabled={saving} onClick={() => void handleSave()}>
          {saving ? '保存中...' : '保存'}
        </button>
      }
    >
      <div className="op-field">
        <label htmlFor="editName">模型名称</label>
        <input id="editName" type="text" placeholder="DeepSeek" value={form.name} onChange={update('name')} />
      </div>
      <div className="op-field">
        <label htmlFor="editBaseUrl">Base URL</label>
        <input id="editBaseUrl" type="text" placeholder="https://api.deepseek.com/v1" value={form.baseUrl} onChange={update('baseUrl')} />
      </div>
      <div className="op-field">
        <label htmlFor="editApiKey">API Key</label>
        <div className="op-input-wrap">
          <input id="editApiKey" type={showApiKey ? 'text' : 'password'} placeholder="sk-..." value={form.apiKey} onChange={update('apiKey')} />
          <button
            className="op-eye"
            style={{ opacity: showApiKey ? '1' : '0.6' }}
            onClick={() => setShowApiKey((prev) => !prev)}
            title="显示/隐藏 API Key"
          >
            <EyeIcon width={16} height={16} />
          </button>
        </div>
      </div>
      <div className="op-field">
        <label htmlFor="editModel">模型 ID</label>
        <input id="editModel" type="text" placeholder="deepseek-chat" value={form.model} onChange={update('model')} />
      </div>
      {status.message ? <div className={`op-form-status ${status.type}`}>{status.message}</div> : <div className="op-form-status" />}
    </Modal>
  )
}
