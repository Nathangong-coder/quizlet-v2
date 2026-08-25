import { describe, it, expect } from 'vitest'
import { resolveKltWrites } from '@/lib/klt/resolve'

const ids = ['klp-a', 'klp-b']

describe('resolveKltWrites', () => {
  it('maps refs to klp ids by position', () => {
    expect(resolveKltWrites([{ ref: 1, label: 'Second point', concepts: ['WACC'] }], ids)).toEqual([
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
        { ref: 7, label: 'Nowhere', concepts: ['WACC'] },
        { ref: 0, label: 'Real', concepts: [] },
      ],
      ids,
    )
    expect(out.map((w) => w.klpId)).toEqual(['klp-a'])
  })

  it('ranks topics by the order the model gave them', () => {
    const out = resolveKltWrites(
      [{ ref: 0, label: 'x', concepts: ['WACC', 'Tax Shield', 'Bankruptcy'] }],
      ids,
    )
    expect(out[0].topics.map((t) => t.rank)).toEqual([1, 2, 3])
  })

  it('drops an invalid topic and RE-RANKS so ranks stay contiguous from 1', () => {
    // A gap would make rank mean two different things depending on what the
    // model happened to return, and masteryTopicRanks reads rank as a cutoff.
    const out = resolveKltWrites(
      [{ ref: 0, label: 'x', concepts: ['the weighted average cost of capital', 'Bankruptcy'] }],
      ids,
    )
    expect(out[0].topics).toEqual([{ name: 'Bankruptcy', normalizedName: 'bankruptcy', rank: 1 }])
  })

  it('dedupes topics that normalize to the same key, keeping the best rank', () => {
    const out = resolveKltWrites([{ ref: 0, label: 'x', concepts: ['WACC', 'wacc', 'Bankruptcy'] }], ids)
    expect(out[0].topics).toEqual([
      { name: 'WACC', normalizedName: 'wacc', rank: 1 },
      { name: 'Bankruptcy', normalizedName: 'bankruptcy', rank: 2 },
    ])
  })

  it('keeps a KLP whose topics were ALL invalid — the label still lands', () => {
    const out = resolveKltWrites(
      [{ ref: 0, label: 'Still useful', concepts: ['a sentence that is far too long to be a topic'] }],
      ids,
    )
    expect(out).toEqual([{ klpId: 'klp-a', label: 'Still useful', topics: [] }])
  })

  it('keeps the topics when the label is blank — the two grains fail apart', () => {
    const out = resolveKltWrites([{ ref: 0, label: '   ', concepts: ['WACC'] }], ids)
    expect(out).toEqual([
      { klpId: 'klp-a', label: null, topics: [{ name: 'WACC', normalizedName: 'wacc', rank: 1 }] },
    ])
  })

  it('keeps only the first entry when the model repeats a ref', () => {
    const out = resolveKltWrites(
      [
        { ref: 0, label: 'First', concepts: [] },
        { ref: 0, label: 'Second', concepts: [] },
      ],
      ids,
    )
    expect(out).toEqual([{ klpId: 'klp-a', label: 'First', topics: [] }])
  })

  it('collapses internal whitespace in a label', () => {
    expect(resolveKltWrites([{ ref: 0, label: ' Debt   impact ', concepts: [] }], ids)[0].label).toBe(
      'Debt impact',
    )
  })

  it('returns nothing for an empty reply', () => {
    expect(resolveKltWrites([], ids)).toEqual([])
  })
})

describe('resolveKltWrites — label validation', () => {
  const PROPOSITION =
    'Taking on excessive debt increases financial distress and bankruptcy risk, driving debt holders to demand higher interest rates.'

  it('DROPS a label that is just the proposition echoed back', () => {
    // The failure this guard exists for: a model that ignores "3 to 6 words"
    // and returns the KLP text verbatim. Persisting it makes the label layer
    // pointless — the row reads exactly as it did before the KLT layer existed.
    const out = resolveKltWrites([{ ref: 0, label: PROPOSITION, concepts: ['Bankruptcy'] }], ids)
    expect(out[0].label).toBeNull()
  })

  it('keeps the TOPICS when only the label was unusable', () => {
    const out = resolveKltWrites([{ ref: 0, label: PROPOSITION, concepts: ['Bankruptcy'] }], ids)
    expect(out[0].topics).toEqual([
      { name: 'Bankruptcy', normalizedName: 'bankruptcy', rank: 1 },
    ])
  })

  it('accepts a label at the length the prompt actually asks for', () => {
    const out = resolveKltWrites([{ ref: 0, label: 'Debt impact on WACC', concepts: [] }], ids)
    expect(out[0].label).toBe('Debt impact on WACC')
  })

  it('NEVER truncates — a half-sentence headline is worse than none', () => {
    const out = resolveKltWrites([{ ref: 0, label: PROPOSITION, concepts: ['Bankruptcy'] }], ids)
    expect(out[0].label).toBeNull()
    expect(JSON.stringify(out)).not.toContain('Taking on excessive')
  })

  it('drops the whole entry when the label is unusable AND there are no topics', () => {
    // Writing it would only cost an UPDATE setting label to the null it is.
    expect(resolveKltWrites([{ ref: 0, label: PROPOSITION, concepts: [] }], ids)).toEqual([])
  })

  it('accepts a label right at the cap but not one word past it', () => {
    const eight = 'One two three four five six seven eight'
    expect(resolveKltWrites([{ ref: 0, label: eight, concepts: [] }], ids)[0].label).toBe(eight)
    expect(resolveKltWrites([{ ref: 0, label: `${eight} nine`, concepts: [] }], ids)).toEqual([])
  })

  it('keeps a KLP whose LABEL was unusable — the topics still land', () => {
    const out = resolveKltWrites([{ ref: 0, label: PROPOSITION, concepts: ['WACC'] }], ids)
    expect(out).toEqual([
      { klpId: 'klp-a', label: null, topics: [{ name: 'WACC', normalizedName: 'wacc', rank: 1 }] },
    ])
  })
})
