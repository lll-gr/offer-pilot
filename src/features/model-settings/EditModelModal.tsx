import { useEffect, useState } from 'react'

import EyeIcon from '@/assets/icons/eye.svg'
import { testModelConnection } from '@/ai/chat'
import { Modal } from '@/components/Modal'
import type { ModelConfig } from '@/models/storage'
import type { ModelFormValues } from './useModels'

interface EditModelModalProps {
  open: boolean
  onClose: () => void
  editingModel: ModelConfig | null
  saveModel: (editingModelId: string | null, values: ModelFormValues) => Promise<void>
  /** 新建表单默认值（由 useModels 提供） */
  createDefaults?: ModelFormValues
}

export function EditModelModal({ open, onClose, editingModel, saveModel, createDefaults }: EditModelModalProps) {
  const defaults = createDefaults || { name: '', baseUrl: '', apiKey: '', model: '' }
  const [form, setForm] = useState<ModelFormValues>(defaults)
  const [status, setStatus] = useState<{ type: string; message: string }>({ type: '', message: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
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
      setForm(defaults)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaults 为静态值，仅随 open/editingModel 重置
  }, [open, editingModel])

  const update = (key: keyof ModelFormValues) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }))
  }

  const handleTest = async () => {
    const { baseUrl, apiKey, model } = form
    if (!baseUrl || !apiKey || !model) {
      setStatus({ type: 'error', message: '请先填写 Base URL / API Key / 模型 ID 再测试' })
      return
    }

    setTesting(true)
    setStatus({ type: '', message: '' })

    // 探针复用 chat.ts（与真实填充同一条 URL 拼装/超时/错误翻译链路），表单值直测不落盘
    const result = await testModelConnection({ baseUrl, apiKey, model })

    if (result.ok) {
      setStatus({ type: 'success', message: `连接成功（${result.elapsedMs}ms），模型可用` })
    } else {
      const hint = result.error.includes('网络请求失败') ? '（网络不通或地址错误）' : ''
      setStatus({ type: 'error', message: `连接失败：${result.error}${hint}` })
    }
    setTesting(false)
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
        <div className="op-modal-footer-row">
          <button className="op-btn op-btn-ghost" disabled={testing || saving} onClick={() => void handleTest()}>
            {testing ? '测试中...' : '测试连接'}
          </button>
          <button className="op-btn op-btn-primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
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
