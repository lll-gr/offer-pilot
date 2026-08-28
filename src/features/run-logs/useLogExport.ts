/**
 * 日志目录自动导出 hook：选择/恢复项目目录，会话结束时写盘。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  LOGS_DIR_NAME,
  ensureLogsDirectoryHandle,
  getPermissionState,
  loadProjectRootHandle,
  saveProjectRootHandle,
  supportsDirectoryPicker,
  writeSessionLogFile,
} from '@/logs/export'
import type { FillSession } from '@/logs/export'

export interface LogExportState {
  supported: boolean
  buttonLabel: string
  statusText: string
}

const UNSUPPORTED_STATE: LogExportState = {
  supported: false,
  buttonLabel: '不支持目录写入',
  statusText: '当前浏览器不支持项目目录自动写入。你仍然可以在侧边栏里查看运行日志。',
}

const NOT_CONFIGURED_STATE: LogExportState = {
  supported: true,
  buttonLabel: '选择项目目录',
  statusText: '未配置自动导出。点击“选择项目目录”后，填充诊断日志会自动保存到所选目录下的 debug-logs/。',
}

export function useLogExport(onLog: (level: string, message: string) => void) {
  const [state, setState] = useState<LogExportState>(NOT_CONFIGURED_STATE)
  const [selecting, setSelecting] = useState(false)
  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const onLogRef = useRef(onLog)
  onLogRef.current = onLog

  const refresh = useCallback(async () => {
    if (!supportsDirectoryPicker()) {
      rootHandleRef.current = null
      setState(UNSUPPORTED_STATE)
      return
    }

    let handle: FileSystemDirectoryHandle | null = null
    try {
      handle = await loadProjectRootHandle()
    } catch (error) {
      rootHandleRef.current = null
      setState({
        supported: true,
        buttonLabel: '选择项目目录',
        statusText: `读取日志目录配置失败：${(error as Error).message}`,
      })
      return
    }

    if (!handle) {
      rootHandleRef.current = null
      setState(NOT_CONFIGURED_STATE)
      return
    }

    const permission = await getPermissionState(handle)
    if (permission !== 'granted') {
      rootHandleRef.current = null
      setState({
        supported: true,
        buttonLabel: '重新选择项目目录',
        statusText: '之前记住的项目目录权限已失效。点击“重新选择项目目录”后，将继续自动保存到 debug-logs/。',
      })
      return
    }

    rootHandleRef.current = handle
    setState({
      supported: true,
      buttonLabel: '重新选择项目目录',
      statusText: `已配置自动导出：${handle.name}/${LOGS_DIR_NAME}/`,
    })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectDirectory = useCallback(async () => {
    if (!supportsDirectoryPicker()) {
      onLogRef.current('error', '当前浏览器不支持项目目录写入')
      return
    }

    setSelecting(true)
    try {
      const rootHandle = await (
        window as unknown as {
          showDirectoryPicker: (options?: { id?: string; mode?: string }) => Promise<FileSystemDirectoryHandle>
        }
      ).showDirectoryPicker({ id: 'resume-log-project-root', mode: 'readwrite' })

      const permission = await getPermissionState(rootHandle, { request: true })
      if (permission !== 'granted') {
        throw new Error('目录写入权限未授予')
      }

      await ensureLogsDirectoryHandle(rootHandle)
      await saveProjectRootHandle(rootHandle)
      rootHandleRef.current = rootHandle
      await refresh()
      onLogRef.current('success', `诊断日志将自动保存到 ${rootHandle.name}/${LOGS_DIR_NAME}/`)
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        onLogRef.current('info', '已取消选择项目目录')
      } else {
        onLogRef.current('error', `设置日志目录失败：${(error as Error).message}`)
      }
    } finally {
      setSelecting(false)
    }
  }, [refresh])

  const exportSession = useCallback(async (session: FillSession) => {
    const rootHandle = rootHandleRef.current
    if (!rootHandle) return

    try {
      const permission = await getPermissionState(rootHandle)
      if (permission !== 'granted') {
        rootHandleRef.current = null
        onLogRef.current('warning', '项目目录授权已失效，本次未自动保存日志。请重新点击“选择项目目录”。')
        await refresh()
        return
      }

      const saved = await writeSessionLogFile(rootHandle, session)
      onLogRef.current('info', `诊断日志已自动保存到 ${saved.relativePath}`)
    } catch (error) {
      onLogRef.current('error', `诊断日志保存失败：${(error as Error).message}`)
    }
  }, [refresh])

  return { state, selecting, selectDirectory, exportSession }
}
