import { describe, it, expect } from 'vitest'
import { assembleCandidates, KLT_CANDIDATE_CAP } from '@/lib/klt/candidates'

const existing = [
  { name: 'WACC', normalizedName: 'wacc', linkCount: 50 },
  { name: 'Terminal Value', normalizedName: 'terminal value', linkCount: 3 },
  { name: 'Bankruptcy', normalizedName: 'bankruptcy', linkCount: 1 },
  { name: 'Photosynthesis', normalizedName: 'photosynthesis', linkCount: 99 },
]

describe('assembleCandidates', () => {
  it('puts set-local topics first — a set is usually one subject', () => {
    const out = assembleCandidates({ setLocal: ['bankruptcy'], existing, klpTexts: [] })
    expect(out[0]).toBe('Bankruptcy')
  })

  it('includes topics whose name overlaps the batch text', () => {
    const out = assembleCandidates({
      setLocal: [],
      existing,
      klpTexts: ['Discount the cash flows using WACC and a terminal value.'],
    })
    expect(out.slice(0, 2).sort()).toEqual(['Terminal Value', 'WACC'])
  })

  it('fills remaining slots with the globally most-linked topics', () => {
    const out = assembleCandidates({ setLocal: [], existing, klpTexts: [] })
    expect(out[0]).toBe('Photosynthesis') // linkCount 99
    expect(out[1]).toBe('WACC') // linkCount 50
  })

  it('never repeats a topic that qualified under two tiers', () => {
    const out = assembleCandidates({
      setLocal: ['wacc'],
      existing,
      klpTexts: ['WACC matters here'],
    })
    expect(out.filter((n) => n === 'WACC')).toHaveLength(1)
  })

  it('ignores short words so "the" does not match everything', () => {
    const out = assembleCandidates({
      setLocal: [],
      existing: [{ name: 'The', normalizedName: 'the', linkCount: 0 }],
      klpTexts: ['The cash flow is the thing'],
    })
    // Reachable only via the popularity tail, never via overlap.
    expect(out).toEqual(['The'])
  })

  it('caps the list', () => {
    const many = Array.from({ length: KLT_CANDIDATE_CAP + 50 }, (_, i) => ({
      name: `topic ${i}`,
      normalizedName: `topic ${i}`,
      linkCount: 1,
    }))
    expect(assembleCandidates({ setLocal: [], existing: many, klpTexts: [] })).toHaveLength(
      KLT_CANDIDATE_CAP,
    )
  })

  it('never lets globally-popular topics crowd out set-local ones at the cap', () => {
    // The ordering guarantee that matters: truncation happens LAST, so a
    // popular unrelated topic can never displace a topic from this set.
    const many = Array.from({ length: KLT_CANDIDATE_CAP + 50 }, (_, i) => ({
      name: `topic ${i}`,
      normalizedName: `topic ${i}`,
      linkCount: 100,
    }))
    const out = assembleCandidates({
      setLocal: ['mine'],
      existing: [...many, { name: 'Mine', normalizedName: 'mine', linkCount: 0 }],
      klpTexts: [],
    })
    expect(out).toHaveLength(KLT_CANDIDATE_CAP)
    expect(out[0]).toBe('Mine')
  })

  it('returns nothing when the vocabulary is empty', () => {
    expect(assembleCandidates({ setLocal: [], existing: [], klpTexts: ['anything'] })).toEqual([])
  })
})
