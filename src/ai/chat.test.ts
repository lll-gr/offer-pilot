import { describe, expect, it, vi } from 'vitest'

import { buildApiUrl, testModelConnection } from './chat'
import type { ResponseLike } from './chat'

function jsonResponse(status: number, body: unknown): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }
}

describe('buildApiUrl', () => {
  it('appends chat/completions and strips query/hash', () => {
    expect(buildApiUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(buildApiUrl('https://api.x.com/v1/?debug=1#frag')).toBe('https://api.x.com/v1/chat/completions')
  })

  it('keeps an explicit chat/completions path', () => {
    expect(buildApiUrl('https://api.x.com/v1/chat/completions')).toBe('https://api.x.com/v1/chat/completions')
  })

  it('rejects non-https except localhost', () => {
    expect(() => buildApiUrl('http://api.x.com/v1')).toThrow(/HTTPS/)
    expect(buildApiUrl('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/v1/chat/completions')
    expect(() => buildApiUrl('not-a-url')).toThrow(/有效地址/)
  })
})

describe('testModelConnection', () => {
  const config = { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test', model: 'deepseek-chat' }

  it('reports success with elapsed time', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }))
    const result = await testModelConnection(config, { fetch: fetchImpl as never, logError: () => {} })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.elapsedMs).toBeGreaterThanOrEqual(0)

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
    const body = JSON.parse(String(init.body)) as { max_tokens: number; messages: Array<{ role: string }> }
    expect(body.max_tokens).toBe(1) // 探针最小开销
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' })
  })

  it('translates auth failure to friendly error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: { message: 'bad key' } }))
    const result = await testModelConnection(config, { fetch: fetchImpl as never, logError: () => {} })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('API Key 无效')
  })

  it('wraps network errors without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Failed to fetch')
    })
    const result = await testModelConnection(config, { fetch: fetchImpl as never, logError: () => {} })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('网络请求失败')
  })

  it('rejects invalid baseUrl without fetching', async () => {
    const fetchImpl = vi.fn()
    const result = await testModelConnection(
      { ...config, baseUrl: 'http://insecure.example.com' },
      { fetch: fetchImpl as never, logError: () => {} }
    )

    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
