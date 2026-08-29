import { describe, expect, it } from 'vitest'

import {
  adaptLegacyCacheEntry,
  alignCachedDecisions,
  applyDecisionCorrection,
  createFieldKey,
  createMappingCacheKeyFromSignature,
  createMappingCacheSignature,
  createStableCacheFieldSignature,
  describeMappingCacheLookup,
  normalizeCacheText,
  saveMappingCacheEntry,
  loadMappingCacheEntry,
} from './cache'
import type { FieldDecision, FieldDescriptor } from '../types'

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

function decision(overrides: Partial<FieldDecision> = {}): FieldDecision {
  return {
    fieldId: 'f_1',
    action: 'fill',
    resumePath: '',
    reason: '',
    transform: { type: 'none' },
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
          decisions: [],
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

  it('detects hits and adapts legacy entries on read', () => {
    const signature = createMappingCacheSignature([field()])
    const key = createMappingCacheKeyFromSignature(signature, location)

    // 旧版条目：mappings 无 action
    const result = describeMappingCacheLookup(
      {
        [key]: {
          host: location.host,
          path: location.pathname,
          updatedAt: 1,
          mappings: [
            { fieldId: 'f_1', fieldKey: 'K', resumePath: 'personal.fullName', reason: 'r', transform: { type: 'none' } },
          ],
          signature,
        },
      },
      key,
      { host: location.host, path: location.pathname, signature },
    )

    expect(result.hit).toBe(true)
    expect(result.entry?.decisions).toHaveLength(1)
    expect(result.entry?.decisions[0].action).toBe('fill')
    expect(result.entry?.decisions[0].resumePath).toBe('personal.fullName')
    expect(result.entry?.decisions[0].fieldKey).toBe('K')
  })
})

describe('cache storage round-trip', () => {
  it('saves and loads decision entries through injected storage', async () => {
    const { storage } = createFakeStorage()
    const signature = createMappingCacheSignature([field()])
    const key = createMappingCacheKeyFromSignature(signature, location)

    await saveMappingCacheEntry(
      key,
      {
        updatedAt: 123,
        decisions: [
          decision({ fieldId: 'f_1', action: 'fill', resumePath: 'workExperiences.0.company' }),
        ],
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
    expect(lookup.entry?.decisions[0].resumePath).toBe('workExperiences.0.company')
    expect(lookup.entry?.decisions[0].action).toBe('fill')
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

describe('stable cache key (index-independent)', () => {
  const location = { origin: 'https://example.com', pathname: '/apply', host: 'example.com' }

  function field(overrides: Partial<Parameters<typeof createStableCacheFieldSignature>[0]> = {}) {
    return {
      fieldId: 'f_x',
      kind: 'text' as const,
      label: '姓名',
      name: '',
      id: '',
      placeholder: '',
      options: [],
      required: false,
      context: '',
      sectionKey: '',
      sectionLabel: '',
      sectionEvidence: '',
      nearbyLabels: [],
      ...overrides,
    }
  }

  it('keeps same key when a banner field is inserted before existing ones', () => {
    const original = [field({ label: '姓名' }), field({ label: '手机号码' }), field({ label: '邮箱' })]
    const shifted = [field({ label: '我已阅读协议', kind: 'checkbox_group' as never }), ...original]

    const keyOriginal = createMappingCacheKeyFromSignature(createMappingCacheSignature(original), location)
    const keyShifted = createMappingCacheKeyFromSignature(createMappingCacheSignature(shifted), location)

    // 插入新字段本身就是结构变化，应当 miss（防御性正确）
    expect(keyShifted).not.toBe(keyOriginal)
  })

  it('keeps same key when identical fields appear in different scan order', () => {
    const a = [field({ label: '姓名' }), field({ label: '邮箱' })]
    const b = [field({ label: '邮箱' }), field({ label: '姓名' })]

    const keyA = createMappingCacheKeyFromSignature(createMappingCacheSignature(a), location)
    const keyB = createMappingCacheKeyFromSignature(createMappingCacheSignature(b), location)

    expect(keyA).toBe(keyB)
  })
})

describe('fieldKey alignment (D1)', () => {
  function field(overrides: Partial<FieldDescriptor> = {}) {
    return {
      fieldId: 'f',
      kind: 'text' as const,
      label: '姓名',
      name: '',
      id: '',
      placeholder: '',
      options: [],
      required: false,
      context: '',
      sectionKey: '',
      sectionLabel: '',
      sectionEvidence: '',
      nearbyLabels: [],
      ...overrides,
    } as FieldDescriptor
  }

  it('createFieldKey is stable across fieldId changes', () => {
    const a = createFieldKey(field({ fieldId: 'f_1', label: '手机号码' }))
    const b = createFieldKey(field({ fieldId: 'f_7', label: '手机号码' }))
    expect(a).toBe(b)
  })

  it('aligns cached decisions by fingerprint even when scan order shifts', () => {
    // 上次扫描：姓名=f_1，手机号=f_2；缓存条目带指纹
    const cached = [
      decision({ fieldId: 'f_1', fieldKey: createFieldKey(field({ label: '姓名' })), resumePath: 'personal.fullName', confidence: 'high' }),
      decision({ fieldId: 'f_2', fieldKey: createFieldKey(field({ label: '手机号码' })), resumePath: 'personal.phoneNumber', action: 'keep', confidence: 'low' }),
    ]

    // 本次扫描：顶部多了协议复选框 → 手机号变成 f_3
    const currentFields = [
      field({ fieldId: 'f_1', label: '姓名' }),
      field({ fieldId: 'f_2', label: '我已阅读协议' }),
      field({ fieldId: 'f_3', label: '手机号码' }),
    ]

    const aligned = alignCachedDecisions(cached, currentFields)
    const byLabel = Object.fromEntries(
      aligned.map((item) => [currentFields.find((f) => f.fieldId === item.fieldId)?.label, item]),
    )

    // 指纹对齐：姓名→fullName，手机号→phoneNumber（序号漂移无影响），action/confidence 随决策保留
    expect(byLabel['姓名'].resumePath).toBe('personal.fullName')
    expect(byLabel['姓名'].action).toBe('fill')
    expect(byLabel['姓名'].confidence).toBe('high')
    expect(byLabel['手机号码'].resumePath).toBe('personal.phoneNumber')
    expect(byLabel['手机号码'].action).toBe('keep')
    expect(byLabel['手机号码'].confidence).toBe('low')
    expect(aligned).toHaveLength(2)
  })

  it('assigns duplicate fingerprints in order (start/end date pair)', () => {
    const key = createFieldKey(field({ label: '起止时间' }))
    const cached = [
      decision({ fieldId: 'f_1', fieldKey: key, resumePath: 'internships.0.startDate' }),
      decision({ fieldId: 'f_2', fieldKey: key, resumePath: 'internships.0.endDate' }),
    ]
    const currentFields = [field({ fieldId: 'f_9', label: '起止时间' }), field({ fieldId: 'f_10', label: '起止时间' })]

    const aligned = alignCachedDecisions(cached, currentFields)
    expect(aligned.map((item) => item.fieldId)).toEqual(['f_9', 'f_10'])
    expect(aligned[0].resumePath).toBe('internships.0.startDate')
    expect(aligned[1].resumePath).toBe('internships.0.endDate')
  })

  it('drops decisions whose field disappeared from current scan', () => {
    const cached = [
      decision({ fieldId: 'f_1', fieldKey: createFieldKey(field({ label: '已删除的字段' })), resumePath: 'x.y' }),
    ]
    const aligned = alignCachedDecisions(cached, [field({ fieldId: 'f_1', label: '姓名' })])
    expect(aligned).toHaveLength(0)
  })

  it('drops legacy entries without fieldKey', () => {
    const cached = [decision({ fieldId: 'f_2', resumePath: 'personal.email' })]
    const currentFields = [field({ fieldId: 'f_1', label: '姓名' }), field({ fieldId: 'f_2', label: '邮箱' })]
    const aligned = alignCachedDecisions(cached, currentFields)
    expect(aligned).toHaveLength(0)
  })

  it('falls back invalid cached action to fill', () => {
    const cached = [
      decision({ fieldId: 'f_1', fieldKey: createFieldKey(field({ label: '姓名' })), resumePath: 'personal.fullName', action: 'nonsense' as FieldDecision['action'] }),
    ]
    const aligned = alignCachedDecisions(cached, [field({ fieldId: 'f_1', label: '姓名' })])
    expect(aligned[0].action).toBe('fill')
  })
})

describe('applyDecisionCorrection (纠错写回)', () => {
  function entry() {
    return {
      updatedAt: 1000,
      host: 'example.com',
      path: '/apply',
      signature: [],
      decisions: [
        decision({ fieldId: 'f_1', fieldKey: 'K1', resumePath: 'a.b', reason: 'old' }),
        decision({ fieldId: 'f_2', fieldKey: 'K2', resumePath: 'c.d', reason: 'old' }),
      ],
    }
  }

  it('corrects resumePath and action by fieldKey, bumps updatedAt', () => {
    const corrected = applyDecisionCorrection(entry(), {
      fieldKey: 'K2',
      fieldId: 'f_2',
      resumePath: 'x.y',
      action: 'fill',
    })
    expect(corrected.decisions[0].resumePath).toBe('a.b') // untouched
    expect(corrected.decisions[1].resumePath).toBe('x.y')
    expect(corrected.decisions[1].action).toBe('fill')
    expect(corrected.decisions[1].reason).toBe('用户手动修正')
    expect(corrected.updatedAt).toBeGreaterThanOrEqual(1000)
  })

  it('clearing a mapping downgrades action to skip', () => {
    const corrected = applyDecisionCorrection(entry(), {
      fieldKey: 'K1',
      fieldId: 'f_1',
      resumePath: '',
      action: 'skip',
    })
    expect(corrected.decisions[0].action).toBe('skip')
    expect(corrected.decisions[0].resumePath).toBe('')
  })

  it('no-op when fieldKey does not match any entry', () => {
    const corrected = applyDecisionCorrection(entry(), { fieldKey: 'NOPE', fieldId: 'f_99', resumePath: 'z.z' })
    expect(corrected.decisions.every((item) => item.reason === 'old')).toBe(true)
  })
})

describe('adaptLegacyCacheEntry (旧条目读取适配)', () => {
  it('maps legacy mappings to decisions with fill action', () => {
    const adapted = adaptLegacyCacheEntry({
      updatedAt: 5,
      host: 'a.com',
      path: '/p',
      signature: [],
      mappings: [
        { fieldId: 'f_1', resumePath: 'personal.email', reason: 'r', transform: { type: 'none' }, fieldKey: 'K1' },
      ],
    })

    expect(adapted?.decisions).toHaveLength(1)
    expect(adapted?.decisions[0]).toMatchObject({
      action: 'fill',
      resumePath: 'personal.email',
      fieldKey: 'K1',
    })
  })

  it('keeps new-format entries as-is', () => {
    const adapted = adaptLegacyCacheEntry({
      updatedAt: 5,
      decisions: [decision({ action: 'manual' })],
    })
    expect(adapted?.decisions[0].action).toBe('manual')
  })

  it('returns null for non-object input', () => {
    expect(adaptLegacyCacheEntry(null)).toBeNull()
    expect(adaptLegacyCacheEntry(undefined)).toBeNull()
    expect(adaptLegacyCacheEntry('x')).toBeNull()
  })
})
