import { describe, expect, it } from 'vitest'

import { callAI, type ResponseLike } from './proxy'
// buildApiUrl 的测试随实现迁至 chat.test.ts

function createResponse(status: number, body: unknown): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body)
    },
    async json() {
      return body
    },
  }
}

const config = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
}

function createDeps(responses: ResponseLike[]) {
  const bodies: Array<Record<string, unknown>> = []
  const deps = {
    fetch: async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      const response = responses.shift()
      if (!response) throw new Error('unexpected extra fetch')
      return response
    },
    getModelConfig: async () => config,
    sleep: async () => {},
    logError: () => {},
  }
  return { deps, bodies }
}

describe('callAI', () => {
  it('requests JSON mode and returns message content', async () => {
    const { deps, bodies } = createDeps([
      createResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] }),
    ])

    const result = await callAI('m', 'prompt', 'resume_import', deps)

    expect(result).toBe('{"ok":true}')
    expect(bodies.length).toBe(1)
    expect(bodies[0].response_format).toEqual({ type: 'json_object' })
    expect(bodies[0].model).toBe('test-model')
    expect(bodies[0].temperature).toBe(0.2)
  })

  it('retries once on 429', async () => {
    const { deps } = createDeps([
      createResponse(429, { error: { message: 'rate limited' } }),
      createResponse(200, { choices: [{ message: { content: '{}' } }] }),
    ])

    const result = await callAI('m', 'prompt', 'form_planning', deps)

    expect(result).toBe('{}')
  })

  it('retries once on 5xx', async () => {
    const { deps } = createDeps([
      createResponse(503, { error: { message: 'unavailable' } }),
      createResponse(200, { choices: [{ message: { content: '{}' } }] }),
    ])

    await expect(callAI('m', 'prompt', 'form_planning', deps)).resolves.toBe('{}')
  })

  it('falls back without response_format when provider rejects it', async () => {
    const { deps, bodies } = createDeps([
      createResponse(400, { error: { message: 'response_format is not supported' } }),
      createResponse(200, { choices: [{ message: { content: '{}' } }] }),
    ])

    const result = await callAI('m', 'prompt', 'resume_import', deps)

    expect(result).toBe('{}')
    expect(bodies[0].response_format).toEqual({ type: 'json_object' })
    expect('response_format' in bodies[1]).toBe(false)
  })

  it('surfaces friendly errors for auth failures', async () => {
    const { deps } = createDeps([createResponse(401, { error: { message: 'bad key' } })])

    await expect(callAI('m', 'prompt', 'resume_import', deps)).rejects.toThrow(/API Key 无效/)
  })

  it('rejects incomplete model config', async () => {
    const { deps } = createDeps([])
    deps.getModelConfig = async () => ({ baseUrl: '', apiKey: '', model: '' })

    await expect(callAI('m', 'prompt', 'resume_import', deps)).rejects.toThrow(/模型配置不完整/)
  })

  it('rejects malformed success payloads', async () => {
    const { deps } = createDeps([createResponse(200, { nope: true })])

    await expect(callAI('m', 'prompt', 'resume_import', deps)).rejects.toThrow(/API 返回格式错误/)
  })

  it('rejects unknown modes', async () => {
    const { deps } = createDeps([])

    await expect(callAI('m', 'prompt', 'unknown-mode', deps)).rejects.toThrow(/不支持的 AI 模式/)
  })
})
