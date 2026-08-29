/**
 * 模型配置状态 hook：加载/保存/激活/删除，供侧边栏设置弹窗使用。
 * 模型列表纯用户自建（无内置项），空列表时激活 id 为空串。
 */

import { useCallback, useEffect, useState } from 'react'

import {
  loadModelState,
  saveActiveModelId,
  saveModelState,
  validateBaseUrl,
} from '@/models/storage'
import type { ModelConfig } from '@/models/storage'

export interface ModelFormValues {
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

/** 新建模型的表单默认值（常用入门配置，可改） */
const CREATE_DEFAULTS: ModelFormValues = {
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
}

export function useModels() {
  const [models, setModels] = useState<ModelConfig[]>([])
  const [activeModelId, setActiveModelId] = useState<string>('')

  const refresh = useCallback(async () => {
    const state = await loadModelState()
    setModels(state.models)
    setActiveModelId(state.activeModelId)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activateModel = useCallback(
    async (modelId: string) => {
      await saveActiveModelId(modelId)
      await refresh()
    },
    [refresh]
  )

  const deleteModel = useCallback(
    async (modelId: string) => {
      const state = await loadModelState()
      const modelsWithoutCurrent = state.models.filter((model) => model.id !== modelId)

      await saveModelState({ models: modelsWithoutCurrent })

      // 删的是激活模型时回退到剩余第一个（loadModelState 内处理空列表）
      if (state.activeModelId === modelId) {
        await saveActiveModelId(modelsWithoutCurrent[0]?.id || '')
      }
      await refresh()
    },
    [refresh]
  )

  const saveModel = useCallback(
    async (editingModelId: string | null, values: ModelFormValues) => {
      const { name, baseUrl, apiKey, model } = values

      if (!name || !baseUrl || !apiKey || !model) {
        throw new Error('请填写所有配置项')
      }

      validateBaseUrl(baseUrl)

      const state = await loadModelState()
      const nextModels = [...state.models]

      if (editingModelId) {
        const index = nextModels.findIndex((item) => item.id === editingModelId)
        if (index !== -1) {
          nextModels[index] = { ...nextModels[index], name, baseUrl, apiKey, model }
        }
      } else {
        const created = {
          id: `custom-${Date.now()}`,
          name,
          baseUrl,
          apiKey,
          model,
        }
        nextModels.push(created)
        // 首个模型自动激活，省一次点击
        if (nextModels.length === 1) {
          await saveActiveModelId(created.id)
        }
      }

      await saveModelState({ models: nextModels })
      await refresh()
    },
    [refresh]
  )

  return {
    models,
    activeModelId,
    refresh,
    activateModel,
    deleteModel,
    saveModel,
    createDefaults: CREATE_DEFAULTS,
  }
}
