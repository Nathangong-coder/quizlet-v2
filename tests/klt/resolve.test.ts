import { describe, it, expect } from 'vitest'
import { resolveKltWrites } from '@/lib/klt/resolve'

const ids = ['klp-a', 'klp-b']

describe('resolveKltWrites', () => {
  it('maps refs to klp ids by position', () => {
    expect(resolveKltWrites([{ ref: 1, label: 'Second point', topics: ['WACC'] }], ids)).toEqual([
      {
        klpId: 'klp-b',
        label: 'Second point',
        topics: [{ name: 'WACC', normalizedName: 'wacc', rank: 1 }],
      },
    ])
  })

  it('DROPS a hallucinated ref rather than writing it onto another KLP', () => {
    const out = resolveKltWrites(
      [
        { ref: 7, label: 'Nowhere', topics: ['WACC'] },
        { ref: 0, label: 'Real', topics: [] },
      ],
      ids,
    )
    expect(out.map((w) => w.klpId)).toEqual(['klp-a'])
  })

  it('ranks topics by the order the model gave them', () => {
    const out = resolveKltWrites(
      [{ ref: 0, label: 'x', topics: ['WACC', 'Tax Shield', 'Bankruptcy'] }],
      ids,
    )
    expect(out[0].topics.map((t) => t.rank)).toEqual([1, 2, 3])
  })

  it('drops an invalid topic and RE-RANKS so ranks stay contiguous from 1', () => {
    // A gap would make rank mean two different things depending on what the
    // model happened to return, and masteryTopicRanks reads rank as a cutoff.
    const out = resolveKltWrites(
      [{ ref: 0, label: 'x', topics: ['the weighted average cost of capital', 'Bankruptcy'] }],
      ids,
    )
    expect(out[0].topics).toEqual([{ name: 'Bankruptcy', normalizedName: 'bankruptcy', rank: 1 }])
  })

  it('dedupes topics that normalize to the same key, keeping the best rank', () => {
    const out = resolveKltWrites([{ ref: 0, label: 'x', topics: ['WACC', 'wacc', 'Bankruptcy'] }], ids)
    expect(out[0].topics).toEqual([
      { name: 'WACC', normalizedName: 'wacc', rank: 1 },
      { name: 'Bankruptcy', normalizedName: 'bankruptcy', rank: 2 },
    ])
  })

  it('keeps a KLP whose topics were ALL invalid — the label still lands', () => {
    const out = resolveKltWrites(
      [{ ref: 0, label: 'Still useful', topics: ['a sentence that is far too long to be a topic'] }],
      ids,
    )
    expect(out).toEqual([{ klpId: 'klp-a', label: 'Still useful', topics: [] }])
  })

  it('drops an entry whose label is blank — a blank row would render as empty', () => {
    expect(resolveKltWrites([{ ref: 0, label: '   ', topics: ['WACC'] }], ids)).toEqual([])
  })

  it('keeps only the first entry when the model repeats a ref', () => {
    const out = resolveKltWrites(
      [
        { ref: 0, label: 'First', topics: [] },
        { ref: 0, label: 'Second', topics: [] },
      ],
      ids,
    )
    expect(out).toEqual([{ klpId: 'klp-a', label: 'First', topics: [] }])
  })

  it('collapses internal whitespace in a label', () => {
    expect(resolveKltWrites([{ ref: 0, label: ' Debt   impact ', topics: [] }], ids)[0].label).toBe(
      'Debt impact',
    )
  })

  it('returns nothing for an empty reply', () => {
    expect(resolveKltWrites([], ids)).toEqual([])
  })
})
