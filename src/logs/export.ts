/**
 * 填充诊断日志导出到本地项目目录（File System Access API）。
 * 目录句柄持久化在 IndexedDB；导出目录最多保留 MAX_LOG_FILES 个 JSON。
 */

export const LOGS_DIR_NAME = 'debug-logs'
const MAX_LOG_FILES = 50

const DB_NAME = 'resume-log-export-db'
const STORE_NAME = 'handles'
const PROJECT_ROOT_KEY = 'project-root'

export type FillSessionStatus = 'running' | 'success' | 'error' | 'canceled' | 'unknown'

export interface LogEntry {
  level: string
  message: string
  timestamp: string | null
}

export interface FillSession {
  id: string
  startedAt: string
  endedAt: string | null
  status: FillSessionStatus
  errorMessage: string
  tab: {
    id: number | null
    url: string
    title: string
  }
  stats: {
    fieldCount: number
    mappedCount: number
    filledCount: number
  }
  logs: LogEntry[]
}

function compactText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeSegment(value: unknown, fallback = 'unknown'): string {
  const text = compactText(value)
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return text || fallback
}

function formatFileTimestamp(value: string | number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '1970-01-01_00-00-00'
  }

  const pad = (num: number) => String(num).padStart(2, '0')
  return [
    date.getUTCFullYear(),
    '-',
    pad(date.getUTCMonth() + 1),
    '-',
    pad(date.getUTCDate()),
    '_',
    pad(date.getUTCHours()),
    '-',
    pad(date.getUTCMinutes()),
    '-',
    pad(date.getUTCSeconds()),
  ].join('')
}

function getHostFromUrl(url: string): string {
  try {
    return new URL(String(url || '')).host || 'unknown-host'
  } catch {
    return 'unknown-host'
  }
}

export function sanitizeUrlForExport(value: string): string {
  try {
    const url = new URL(String(value || ''))
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

export function buildLogFileName(session: Partial<FillSession> & { url?: string; title?: string }): string {
  const timestamp = formatFileTimestamp(session?.startedAt || Date.now())
  const host = sanitizeSegment(getHostFromUrl(session?.url || session?.tab?.url || ''), 'unknown-host')
  const title = sanitizeSegment(session?.title || session?.tab?.title, 'resume-fill')
  const status = sanitizeSegment(session?.status, 'unknown')
  return `${timestamp}_${host}_${title}-${status}.json`
}

export function createLogExportPayload(session: FillSession): Record<string, unknown> {
  const safeLogs: LogEntry[] = Array.isArray(session?.logs)
    ? session.logs.map((entry) => ({
        level: compactText(entry?.level) || 'info',
        message: compactText(entry?.message),
        timestamp: entry?.timestamp || null,
      }))
    : []

  return {
    sessionId: compactText(session?.id) || null,
    status: compactText(session?.status) || 'unknown',
    startedAt: session?.startedAt || null,
    endedAt: session?.endedAt || null,
    exportedAt: new Date().toISOString(),
    errorMessage: session?.errorMessage || '',
    tab: {
      id: session?.tab?.id ?? null,
      url: sanitizeUrlForExport(session?.tab?.url),
      title: session?.tab?.title || '',
    },
    stats: {
      fieldCount: Number(session?.stats?.fieldCount || 0),
      mappedCount: Number(session?.stats?.mappedCount || 0),
      filledCount: Number(session?.stats?.filledCount || 0),
    },
    logs: safeLogs,
  }
}

export function supportsDirectoryPicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  )
}

// ---------------------------------------------------------------------------
// IndexedDB 目录句柄持久化
// ---------------------------------------------------------------------------

interface IDBFactoryLike {
  open: (name: string, version?: number) => IDBOpenDBRequest
}

function openDb(indexedDb: IDBFactoryLike): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('打开目录授权数据库失败'))
  })
}

function getIndexedDb(): IDBFactoryLike {
  if (typeof indexedDB === 'undefined') {
    throw new Error('当前环境不支持 IndexedDB，无法保存目录授权')
  }
  return indexedDB
}

async function withStore<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => T
): Promise<T> {
  const db = await openDb(getIndexedDb())
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)

    let result: T
    try {
      result = handler(store)
    } catch (error) {
      reject(error)
      return
    }

    tx.oncomplete = () => {
      db.close()
      resolve(result)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error || new Error('访问目录授权数据库失败'))
    }
  })
}

// FileSystemDirectoryHandle 与 FileSystemFileHandle 类型来自 lib.dom。
// Chrome storage 里持久化的 handle 在重启后仍可 queryPermission 复用。

export async function saveProjectRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore('readwrite', (store) => {
    store.put(handle, PROJECT_ROOT_KEY)
  })
}

export async function loadProjectRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb(getIndexedDb())
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(PROJECT_ROOT_KEY)
    request.onsuccess = () => {
      db.close()
      resolve((request.result as FileSystemDirectoryHandle) || null)
    }
    request.onerror = () => {
      db.close()
      reject(request.error || new Error('读取目录授权失败'))
    }
  })
}

export async function clearProjectRootHandle(): Promise<void> {
  await withStore('readwrite', (store) => {
    store.delete(PROJECT_ROOT_KEY)
  })
}

// ---------------------------------------------------------------------------
// 目录权限与文件写入
// ---------------------------------------------------------------------------

export interface PermissionOptions {
  request?: boolean
  mode?: 'read' | 'readwrite'
}

type PermissionMode = 'read' | 'readwrite'

export async function getPermissionState(
  handle: FileSystemDirectoryHandle,
  { request = false, mode = 'readwrite' }: PermissionOptions = {}
): Promise<PermissionState> {
  if (!handle || typeof (handle as { queryPermission?: unknown }).queryPermission !== 'function') {
    return 'prompt'
  }

  const queryable = handle as FileSystemDirectoryHandle & {
    queryPermission: (descriptor: { mode: PermissionMode }) => Promise<PermissionState>
    requestPermission?: (descriptor: { mode: PermissionMode }) => Promise<PermissionState>
  }

  let state = await queryable.queryPermission({ mode })
  if (state !== 'granted' && request && typeof queryable.requestPermission === 'function') {
    state = await queryable.requestPermission({ mode })
  }
  return state
}

export async function ensureLogsDirectoryHandle(rootHandle: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  if (!rootHandle || typeof rootHandle.getDirectoryHandle !== 'function') {
    throw new Error('未配置项目目录')
  }

  return rootHandle.getDirectoryHandle(LOGS_DIR_NAME, { create: true })
}

export async function writeSessionLogFile(
  rootHandle: FileSystemDirectoryHandle,
  session: FillSession
): Promise<{ fileName: string; relativePath: string }> {
  const dirHandle = await ensureLogsDirectoryHandle(rootHandle)
  const fileName = buildLogFileName(session)
  const payload = createLogExportPayload(session)
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()

  try {
    await writable.write(JSON.stringify(payload, null, 2))
  } finally {
    await writable.close()
  }

  await pruneLogFiles(dirHandle)

  return {
    fileName,
    relativePath: `${LOGS_DIR_NAME}/${fileName}`,
  }
}

export async function pruneLogFiles(
  dirHandle: FileSystemDirectoryHandle,
  maxFiles = MAX_LOG_FILES
): Promise<void> {
  const iterable = dirHandle as unknown as { entries?: () => AsyncIterable<[string, { kind: string }]> }
  if (!iterable.entries) return

  const files: string[] = []
  for await (const [name, entry] of iterable.entries()) {
    if (entry?.kind === 'file' && name.endsWith('.json')) {
      files.push(name)
    }
  }

  files.sort()
  const staleFiles = files.slice(0, Math.max(0, files.length - maxFiles))
  for (const name of staleFiles) {
    await dirHandle.removeEntry(name)
  }
}
