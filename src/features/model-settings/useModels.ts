/**
 * 模型配置状态 hook：加载/保存/激活/删除，供侧边栏设置弹窗使用。
 */

import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_MODEL,
  buildBuiltinModel,
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

export function useModels() {
  const [models, setModels] = useState<ModelConfig[]>([])
  const [activeModelId, setActiveModelId] = useState<string>(DEFAULT_MODEL.id)

  const refresh = useCallback(async () => {
    const state = await loadModelState()
    setModels([buildBuiltinModel(state.builtinOverride), ...state.models])
    setActiveModelId(state.activeModelId || DEFAULT_MODEL.id)
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

      await saveModelState({
        models: modelsWithoutCurrent,
        builtinOverride: state.builtinOverride,
      })
      if (state.activeModelId === modelId) {
        await saveActiveModelId(DEFAULT_MODEL.id)
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

      if (editingModelId === DEFAULT_MODEL.id) {
        await saveModelState({
          models: nextModels,
          builtinOverride: { name, baseUrl, apiKey, model },
        })
      } else if (editingModelId) {
        const index = nextModels.findIndex((item) => item.id === editingModelId)
        if (index !== -1) {
          nextModels[index] = { ...nextModels[index], name, baseUrl, apiKey, model }
        }
        await saveModelState({
          models: nextModels,
          builtinOverride: state.builtinOverride,
        })
      } else {
        nextModels.push({
          id: `custom-${Date.now()}`,
          name,
          baseUrl,
          apiKey,
          model,
          builtin: false,
        })
        await saveModelState({
          models: nextModels,
          builtinOverride: state.builtinOverride,
        })
      }

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
  }
}
