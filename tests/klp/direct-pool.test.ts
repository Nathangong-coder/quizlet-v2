import { describe, it, expect } from 'vitest'
import {
  parseList,
  buildDirectPool,
  nextCombo,
  markTried,
  markExhausted,
  poolStatus,
} from '@/lib/klp/direct-pool'

describe('parseList', () => {
  it('splits on commas and whitespace, dropping blanks and duplicates', () => {
    expect(parseList('a, b ,, a  c')).toEqual(['a', 'b', 'c'])
    expect(parseList(undefined)).toEqual([])
    expect(parseList('   ')).toEqual([])
  })
})

describe('buildDirectPool', () => {
  /**
   * The cap is per model per project, so one key exhausted on one model still
   * has a full bucket on another. Rotating keys alone would leave most of the
   * available budget untouched.
   */
  it('is the cross product of keys and models', () => {
    const pool = buildDirectPool(['k1', 'k2'], ['m1', 'm2', 'm3'])
    expect(pool).toHaveLength(6)
    expect(pool.map((c) => c.id)).toEqual([
      'key1:m1', 'key1:m2', 'key1:m3',
      'key2:m1', 'key2:m2', 'key2:m3',
    ])
  })

  /**
   * These ids are printed on every card so a run can be traced. A printed key
   * would land in scrollback, logs, and anything pasted from them.
   */
  it('identifies a combo by key INDEX, never by the key itself', () => {
    const pool = buildDirectPool(['super-secret-key'], ['m1'])
    expect(pool[0].id).toBe('key1:m1')
    expect(JSON.stringify(pool.map((c) => c.id))).not.toContain('super-secret')
  })

  it('starts every combo unused and enabled', () => {
    for (const c of buildDirectPool(['k1'], ['m1', 'm2'])) {
      expect(c.enabled).toBe(true)
      expect(c.lastUsedAt).toBeNull()
    }
  })
})

describe('nextCombo', () => {
  it('spreads across combos, least recently tried first', () => {
    const pool = buildDirectPool(['k1', 'k2'], ['m1'])
    const first = nextCombo(pool)!
    markTried(first, new Date(1_000))
    const second = nextCombo(pool)!
    expect(second.id).not.toBe(first.id)

    markTried(second, new Date(2_000))
    // Both tried; the least recently tried is the first one again.
    expect(nextCombo(pool)!.id).toBe(first.id)
  })

  /**
   * A per-day quota is not a reason to stop the run — it is a reason to stop
   * using THIS pair, which is the entire point of having a pool.
   */
  it('skips an exhausted combo and keeps going', () => {
    const pool = buildDirectPool(['k1'], ['m1', 'm2'])
    const first = nextCombo(pool)!
    markExhausted(first)
    expect(nextCombo(pool)!.id).not.toBe(first.id)
  })

  it('returns undefined only when every combo is exhausted', () => {
    const pool = buildDirectPool(['k1'], ['m1', 'm2'])
    pool.forEach(markExhausted)
    expect(nextCombo(pool)).toBeUndefined()
  })

  it('is empty for an empty pool rather than throwing', () => {
    expect(nextCombo([])).toBeUndefined()
    expect(nextCombo(buildDirectPool([], ['m1']))).toBeUndefined()
  })
})

describe('poolStatus', () => {
  it('reports what is left, and which models still have budget', () => {
    const pool = buildDirectPool(['k1', 'k2'], ['m1', 'm2'])
    markExhausted(pool.find((c) => c.id === 'key1:m1')!)
    markExhausted(pool.find((c) => c.id === 'key2:m1')!)

    expect(poolStatus(pool)).toEqual({
      total: 4,
      available: 2,
      exhausted: 2,
      modelsLeft: ['m2'],
    })
  })
})
