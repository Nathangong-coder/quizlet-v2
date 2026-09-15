import { describe, it, expect } from 'vitest'
import { AI_TASKS } from '@/lib/ai/model-routing'
import { AI_PROVIDERS, PROVIDER_META, resolveLanguageModel } from '@/lib/ai/providers'
import { TASK_PROVIDER_PREFERENCE, providerRank, zaiEffortForTask } from '@/lib/ai/task-defaults'
import { DEFAULT_SHARED_TOKEN_BUDGET } from '@/lib/ai/shared-budget'
import { buildCredentialPool, type PoolInput } from '@/lib/ai/credential-pool'

const cred = (over: Partial<PoolInput> = {}): PoolInput => ({
  id: 'c1',
  label: 'Key 1',
  provider: 'google',
  defaultModel: 'm-default',
  tier: 'paid',
  role: 'primary',
  enabled: true,
  lastUsedAt: null,
  ...over,
})

describe('task defaults (set from the 2026-09-15 benchmark)', () => {
  it('is total over AI_TASKS and names only real providers', () => {
    for (const task of AI_TASKS) {
      const prefs = TASK_PROVIDER_PREFERENCE[task]
      expect(prefs.length).toBeGreaterThan(0)
      for (const p of prefs) expect(AI_PROVIDERS as readonly string[]).toContain(p)
      expect(new Set(prefs).size).toBe(prefs.length)
    }
  })

  it('judgment goes to DeepSeek, writing goes to GLM, Google last at runtime', () => {
    for (const t of ['grade', 'diagnostic', 'concept-tree', 'klp-extract'] as const) expect(TASK_PROVIDER_PREFERENCE[t][0]).toBe('deepseek')
    for (const t of ['distractors', 'game-pieces', 'hot-seat', 'author'] as const) expect(TASK_PROVIDER_PREFERENCE[t][0]).toBe('zai')
    // Google's free tier is hourly-rate-limited, so it is the last resort on every task a
    // learner waits on. Authoring runs in the background and Gemini 3.6 is its quality
    // reference (0.80), so it sits second there.
    for (const task of AI_TASKS) if (task !== 'author') expect(TASK_PROVIDER_PREFERENCE[task].at(-1)).toBe('google')
    expect(TASK_PROVIDER_PREFERENCE.author).toEqual(['zai', 'google', 'deepseek'])
  })

  it('ranks unlisted providers after every listed one', () => {
    expect(providerRank('grade', 'deepseek')).toBe(0)
    expect(providerRank('grade', 'zai')).toBe(1)
    expect(providerRank('grade', 'anthropic')).toBe(TASK_PROVIDER_PREFERENCE.grade.length)
  })

  it('GLM runs low for anything a learner waits on and high for authoring', () => {
    expect(zaiEffortForTask('author')).toBe('high')
    for (const task of AI_TASKS) if (task !== 'author') expect(zaiEffortForTask(task)).toBe('low')
  })

  it('a shared key defaults to 500K tokens a week', () => {
    expect(DEFAULT_SHARED_TOKEN_BUDGET).toBe(500_000)
  })
})

describe('buildCredentialPool with the task’s provider preference', () => {
  const rank = (p: string) => providerRank('grade', p)

  it('orders providers by rank inside a group, LRU breaking ties, never across the own/borrowed boundary', () => {
    const pool = buildCredentialPool({
      credentials: [
        // Borrowed (group 1): DeepSeek is preferred for grading...
        cred({ id: 'shared-zai', provider: 'zai', defaultModel: 'glm-5.3-flash', group: 1, lastUsedAt: null }),
        cred({ id: 'shared-deepseek', provider: 'deepseek', defaultModel: 'deepseek-flash', group: 1, lastUsedAt: new Date('2026-01-01') }),
        // ...but the learner's OWN Google key still goes before any borrowed one.
        cred({ id: 'own-google', provider: 'google', defaultModel: 'gemini-3.6-flash', group: 0 }),
        // Two own DeepSeek keys: least recently used first.
        cred({ id: 'own-ds-new', provider: 'deepseek', defaultModel: 'deepseek-flash', group: 0, lastUsedAt: new Date('2026-02-01') }),
        cred({ id: 'own-ds-old', provider: 'deepseek', defaultModel: 'deepseek-flash', group: 0, lastUsedAt: new Date('2026-01-01') }),
      ],
      extraModels: () => [],
      providerRank: rank,
      limit: 10,
    })
    expect(pool.map((a) => a.credentialId)).toEqual(['own-ds-old', 'own-ds-new', 'own-google', 'shared-deepseek', 'shared-zai'])
  })

  it('without a rank the order is unchanged', () => {
    const a = buildCredentialPool({ credentials: [cred({ id: 'x', provider: 'zai' }), cred({ id: 'y', provider: 'deepseek' })], extraModels: () => [] })
    expect(a.map((p) => p.credentialId)).toEqual(['x', 'y'])
  })
})

describe('zai as a provider', () => {
  it('is first-class, with the Z.ai endpoint and glm-5.3-flash as the default', () => {
    expect(AI_PROVIDERS).toContain('zai')
    expect(PROVIDER_META.zai.defaultModel).toBe('glm-5.3-flash')
    expect(PROVIDER_META.zai.defaultBaseUrl).toBe('https://api.z.ai/api/paas/v4')
    expect(PROVIDER_META.zai.requiresBaseUrl).toBe(false)
  })

  it('resolves without a stored base URL and accepts a reasoning effort', () => {
    expect(resolveLanguageModel({ provider: 'zai', apiKey: 'k', model: 'glm-5.3-flash', reasoningEffort: 'low' })).toBeDefined()
    expect(resolveLanguageModel({ provider: 'zai', apiKey: 'k', model: 'glm-5.3-flash' })).toBeDefined()
  })
})
