import { describe, expect, it } from 'vitest'

import { buildLogFileName, createLogExportPayload, sanitizeUrlForExport } from './export'

describe('log export helpers', () => {
  it('builds a sanitized file name from session metadata', () => {
    const name = buildLogFileName({
      startedAt: '2026-08-28T10:00:00.000Z',
      url: '',
      tab: {
        id: 1,
        url: 'https://zhaopin.example.com/web/apply?token=x#frag',
        title: '候选人申请表',
      },
      status: 'success',
    })

    expect(name).toMatch(/^2026-08-28_10-00-00_zhaopin\.example\.com_/)
    expect(name).toMatch(/-success\.json$/)
    expect(name).not.toContain('token')
  })

  it('sanitizes URLs by stripping query and hash', () => {
    expect(sanitizeUrlForExport('https://a.com/p?x=1#h')).toBe('https://a.com/p')
    expect(sanitizeUrlForExport('invalid')).toBe('')
  })

  it('creates the export payload with normalized logs and stats', () => {
    const payload = createLogExportPayload({
      id: 'fill-1',
      startedAt: '2026-08-28T10:00:00.000Z',
      endedAt: '2026-08-28T10:01:00.000Z',
      status: 'success',
      errorMessage: '',
      tab: { id: 3, url: 'https://a.com/p', title: '表单' },
      stats: { fieldCount: 10, mappedCount: 8, filledCount: 6 },
      logs: [
        { level: 'info', message: '开始扫描', timestamp: '2026-08-28T10:00:01.000Z' },
        { level: '', message: '', timestamp: null },
      ],
    }) as Record<string, unknown>

    expect(payload.status).toBe('success')
    expect((payload.stats as Record<string, number>).filledCount).toBe(6)
    const logs = payload.logs as Array<{ level: string; message: string }>
    expect(logs.length).toBe(2)
    expect(logs[0].level).toBe('info')
    expect(logs[1].level).toBe('info')
  })
})
