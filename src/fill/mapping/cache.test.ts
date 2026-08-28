import { describe, expect, it } from 'vitest'

import {
  createMappingCacheKeyFromSignature,
  createMappingCacheSignature,
  createStableCacheFieldSignature,
  describeMappingCacheLookup,
  normalizeCacheText,
  saveMappingCacheEntry,
  loadMappingCacheEntry,
} from './cache'
import type { FieldDescriptor } from '../types'

function field(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    fieldId: 'f_1',
    kind: 'text',
    label: '公司名称',
    name: '',
    id: '',
    placeholder: '',
    options: [],
    required: false,
    context: '',
    sectionKey: 'work',
    sectionLabel: '工作经历',
    sectionEvidence: '',
    nearbyLabels: [],
    ...overrides,
  }
}

const location = {
  origin: 'https://zhaopin.example.com',
  pathname: '/web/personal-center/resume-detail',
  host: 'zhaopin.example.com',
}

function createFakeStorage() {
  const state: Record<string, unknown> = {}
  return {
    state,
    storage: {
      async get(keys: string[]) {
        const out: Record<string, unknown> = {}
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(state, key)) out[key] = state[key]
        }
        return out
      },
      async set(items: Record<string, unknown>) {
        Object.assign(state, items)
      },
    },
  }
}

describe('normalizeCacheText', () => {
  it('strips prompt-like wrappers and volatile filled values', () => {
    expect(normalizeCacheText('请填写公司名称')).toBe('公司名称')
    expect(normalizeCacheText('请选择请填写学历')).toBe('学历')
    expect(normalizeCacheText('公司名称*全灵')).toBe('公司名称')
    expect(normalizeCacheText('工作类型*实习')).toBe('工作类型')
  })
})

describe('cache keys', () => {
  it('stays stable across empty and filled page states', () => {
    const emptyStateKey = createMappingCacheKeyFromSignature(
      createMappingCacheSignature([
        field({ label: '请填写公司名称', context: '请选择请填写公司名称', nearbyLabels: ['公司名称', '部门名称', '职位名称*请填写职位名称'] }),
      ]),
      location,
    )

    const filledStateKey = createMappingCacheKeyFromSignature(
      createMappingCacheSignature([
        field({ label: '公司名称', context: '全灵', nearbyLabels: ['部门名称', '职位名称', '工作类型*实习'] }),
      ]),
      location,
    )

    expect(emptyStateKey).toBe(filledStateKey)
  })

  it('differs when field labels change', () => {
    const keyA = createMappingCacheKeyFromSignature(createMappingCacheSignature([field({ label: '公司名称' })]), location)
    const keyB = createMappingCacheKeyFromSignature(createMappingCacheSignature([field({ label: '公司简称' })]), location)

    expect(keyA).not.toBe(keyB)
  })
})

describe('describeMappingCacheLookup', () => {
  it('explains same-page cache misses with field diffs', () => {
    const previousSignature = createMappingCacheSignature([field({ label: '公司名称' })])
    const currentSignature = createMappingCacheSignature([field({ label: '公司简称' })])

    const previousKey = createMappingCacheKeyFromSignature(previousSignature, location)
    const currentKey = createMappingCacheKeyFromSignature(currentSignature, location)

    const result = describeMappingCacheLookup(
      {
        [previousKey]: {
          host: 'zhaopin.example.com',
          path: '/web/personal-center/resume-detail',
          updatedAt: 1,
          mappings: [],
          signature: previousSignature,
        },
      },
      currentKey,
      {
        host: 'zhaopin.example.com',
        path: '/web/personal-center/resume-detail',
        signature: currentSignature,
      },
    )

    expect(result.hit).toBe(false)
    expect(result.reason).toMatch(/同页面已有1条缓存/)
    expect(result.reason).toMatch(/字段签名已变化/)
    expect(result.reason).toMatch(/label 公司名称 -> 公司简称/)
  })

  it('reports empty cache distinctly', () => {
    const result = describeMappingCacheLookup({}, 'any-key', {
      host: 'a.com',
      path: '/p',
      signature: createMappingCacheSignature([field()]),
    })

    expect(result.hit).toBe(false)
    expect(result.reason).toMatch(/缓存为空/)
  })

  it('detects hits', () => {
    const signature = createMappingCacheSignature([field()])
    const key = createMappingCacheKeyFromSignature(signature, location)

    const result = describeMappingCacheLookup(
      { [key]: { host: location.host, path: location.pathname, updatedAt: 1, mappings: [], signature } },
      key,
      { host: location.host, path: location.pathname, signature },
    )

    expect(result.hit).toBe(true)
  })
})

describe('cache storage round-trip', () => {
  it('saves and loads entries through injected storage', async () => {
    const { storage } = createFakeStorage()
    const signature = createMappingCacheSignature([field()])
    const key = createMappingCacheKeyFromSignature(signature, location)

    await saveMappingCacheEntry(
      key,
      {
        updatedAt: 123,
        mappings: [{ fieldId: 'f_1', resumePath: 'workExperiences.0.company', reason: '', transform: { type: 'none' } }],
        host: location.host,
        path: location.pathname,
        signature,
      },
      storage,
    )

    const lookup = await loadMappingCacheEntry(
      key,
      { host: location.host, path: location.pathname, signature },
      storage,
    )

    expect(lookup.hit).toBe(true)
    expect(lookup.entry?.mappings[0].resumePath).toBe('workExperiences.0.company')
  })
})

describe('createStableCacheFieldSignature', () => {
  it('keeps index, kind and options but normalizes label text', () => {
    const signature = createStableCacheFieldSignature(field({ label: '请填写公司名称', options: ['全职', '兼职'] }), 3)

    expect(signature.index).toBe(3)
    expect(signature.kind).toBe('text')
    expect(signature.label).toBe('公司名称')
    expect(signature.options).toEqual(['全职', '兼职'])
  })
})
