import { describe, it, expect } from 'vitest'
import { parseRotationSpec, pickRoles, familyOf, familiesAvailable, type RotationCombo } from '@/lib/klp/rotation'

const combo = (source: string, model: string, lastUsedAt: Date | null = null): RotationCombo => ({
  id: `${source}:${model}`, keyIndex: 0, apiKey: 'k', model, provider: source, role: 'primary', enabled: true, lastUsedAt, source, family: familyOf(source),
})

describe('rotation', () => {
  it('parses source:model,model;source:model', () => {
    expect(parseRotationSpec('google:gemini-3.6-flash,gemini-3.5-flash; deepseek:deepseek-v4-flash;zai:glm-5.3-flash;qwen:qwen3.7-flash')).toEqual([
      { source: 'google', model: 'gemini-3.6-flash' }, { source: 'google', model: 'gemini-3.5-flash' }, { source: 'deepseek', model: 'deepseek-v4-flash' }, { source: 'zai', model: 'glm-5.3-flash' }, { source: 'qwen', model: 'qwen3.7-flash' },
    ])
    expect(parseRotationSpec(undefined)).toEqual([])
  })

  it('DeepSeek and GLM are one family; the two Gemini flashes are one family', () => {
    expect(familyOf('deepseek')).toBe(familyOf('zai'))
    expect(familyOf('google')).not.toBe(familyOf('deepseek'))
    expect(familyOf('qwen')).not.toBe(familyOf('deepseek'))
  })

  it('assigns writer, adversary and grader from three different families, LRU first', () => {
    const t = (m: number) => new Date(2026, 8, 12, 0, m)
    const pool = [combo('google', 'gemini-3.6-flash', t(3)), combo('google', 'gemini-3.5-flash', t(1)), combo('deepseek', 'deepseek-v4-flash', t(2)), combo('zai', 'glm-5.3-flash', null), combo('qwen', 'qwen3.7-flash', t(4))]
    const r = pickRoles(pool)!
    expect(r.writer.model).toBe('glm-5.3-flash') // never used -> first
    expect(r.adversary.model).toBe('gemini-3.5-flash') // oldest outside cn
    expect(r.grader.model).toBe('qwen3.7-flash') // the remaining family
    expect(new Set([r.writer.family, r.adversary.family, r.grader.family]).size).toBe(3)
  })

  it('with two families the grader may share the writer\'s family but never the adversary\'s; one family is null', () => {
    const pool = [combo('google', 'gemini-3.6-flash'), combo('deepseek', 'deepseek-v4-flash'), combo('zai', 'glm-5.3-flash')]
    const r = pickRoles(pool)!
    expect(r.adversary.family).not.toBe(r.writer.family)
    expect(r.grader.family).not.toBe(r.adversary.family)
    expect(familiesAvailable(pool)).toEqual(['google', 'cn'])
    expect(pickRoles([combo('deepseek', 'deepseek-v4-flash'), combo('zai', 'glm-5.3-flash')])).toBeNull()
  })
})
