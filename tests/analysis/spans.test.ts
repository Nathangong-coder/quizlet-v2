import { describe, it, expect } from 'vitest'
import { resolveSpan, unionCoverage } from '@/lib/analysis/spans'

const a = 'D&A is added back because it is non-cash, so FCF rises.'

describe('resolveSpan', () => {
  it('exact match', () => expect(resolveSpan(a, 'added back because it is non-cash')).toEqual({ start: 7, end: 40 }))
  it('normalised match ignores case, quotes and whitespace runs', () =>
    expect(resolveSpan(a, 'Added  back because it is NON-CASH')).toEqual({ start: 7, end: 40 }))
  it('first occurrence wins', () => expect(resolveSpan('a b a b', 'a b')).toEqual({ start: 0, end: 3 }))
  it('paraphrase is null', () => expect(resolveSpan(a, 'depreciation is non cash')).toBeNull())
  it('empty quote is null', () => expect(resolveSpan(a, '')).toBeNull())
})

describe('unionCoverage', () => {
  it('merges overlaps', () =>
    expect(unionCoverage([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 20, end: 22 }], 100)).toBeCloseTo(0.17))
})
