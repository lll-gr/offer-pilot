/**
 * AI 返回文本的容错 JSON 解析。
 * 处理：Markdown 代码块、智能引号、尾逗号、JSON 前后夹杂的说明文字。
 */

export function parseJsonFromAiText(text: unknown): unknown {
  const trimmed = normalizeAiJsonInput(text)
  if (!trimmed) throw new Error('AI 返回为空')

  const direct = tryParseJsonVariants(trimmed)
  if (direct.ok) return direct.value

  const noFences = trimmed
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
  const noFenceParsed = tryParseJsonVariants(noFences)
  if (noFenceParsed.ok) return noFenceParsed.value

  for (const candidate of extractJsonCandidates(noFences)) {
    const parsed = tryParseJsonVariants(candidate)
    if (parsed.ok) return parsed.value
  }

  throw new Error('无法解析 AI 返回的 JSON')
}

function normalizeAiJsonInput(text: unknown): string {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .trim()
}

function tryParseJson(text: string): { ok: boolean; value?: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function tryParseJsonVariants(text: string): { ok: boolean; value?: unknown } {
  const candidates = [String(text || '').trim(), sanitizeLikelyJson(text)]
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)

    const parsed = tryParseJson(normalized)
    if (parsed.ok) return parsed
  }

  return { ok: false }
}

function sanitizeLikelyJson(text: string): string {
  return String(text || '')
    .trim()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
}

function extractJsonCandidates(text: string): string[] {
  const candidates = [extractLikelyJson(text), extractBalancedJson(text)]
  return Array.from(new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean)))
}

function extractLikelyJson(text: string): string {
  const firstObj = text.indexOf('{')
  const lastObj = text.lastIndexOf('}')
  const firstArr = text.indexOf('[')
  const lastArr = text.lastIndexOf(']')

  const objCandidate =
    firstObj !== -1 && lastObj !== -1 && lastObj > firstObj ? text.slice(firstObj, lastObj + 1) : null
  const arrCandidate =
    firstArr !== -1 && lastArr !== -1 && lastArr > firstArr ? text.slice(firstArr, lastArr + 1) : null

  if (objCandidate && arrCandidate) {
    return firstObj < firstArr ? objCandidate : arrCandidate
  }
  return objCandidate || arrCandidate || text
}

function extractBalancedJson(text: string): string {
  const source = String(text || '')
  let start = -1
  let inString = false
  let isEscaped = false
  const stack: string[] = []

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (start === -1) {
      if (char === '{' || char === '[') {
        start = index
        stack.push(char)
      }
      continue
    }

    if (inString) {
      if (isEscaped) {
        isEscaped = false
        continue
      }
      if (char === '\\') {
        isEscaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(char)
      continue
    }

    if (char === '}' || char === ']') {
      const last = stack[stack.length - 1]
      const matchesPair = (last === '{' && char === '}') || (last === '[' && char === ']')

      if (!matchesPair) return ''

      stack.pop()
      if (stack.length === 0) {
        return source.slice(start, index + 1)
      }
    }
  }

  return ''
}
