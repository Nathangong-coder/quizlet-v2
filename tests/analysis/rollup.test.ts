import { describe, it, expect } from 'vitest'
import { rollupSessionAnalysis, type RollupAnswer } from '@/lib/analysis/rollup'

// Shape mirrors what getQuizAttemptSummary's extended include will return:
// each answer carries its own analysisStatus, klpResults, and errorTags.
function answer(overrides: Partial<RollupAnswer>): RollupAnswer {
  return {
    analysisStatus: 'analyzed',
    klpResults: [],
    errorTags: [],
    ...overrides,
  }
}

describe('rollupSessionAnalysis', () => {
  it('counts every non-legacy answer toward totalCount, only analyzed ones toward analyzedCount', () => {
    const r = rollupSessionAnalysis([
      answer({ analysisStatus: 'analyzed' }),
      answer({ analysisStatus: 'no_provenance' }),
      answer({ analysisStatus: 'no_klps' }),
      answer({ analysisStatus: null }), // legacy, pre-Spec-2a — excluded, see next test
    ])
    expect(r.totalCount).toBe(3)
    expect(r.analyzedCount).toBe(1)
  })

  it('excludes null (legacy) rows from totalCount entirely', () => {
    // A null predates analysis EXISTING, not a case where it was attempted
    // and failed. Counting it as "not analyzed out of N" overstates how much
    // of a real, post-spec session went unanalyzed.
    const r = rollupSessionAnalysis([
      answer({ analysisStatus: 'analyzed' }),
      answer({ analysisStatus: null }),
    ])
    expect(r.totalCount).toBe(1)
    expect(r.analyzedCount).toBe(1)
  })

  it('only aggregates errors from analyzed answers', () => {
    const r = rollupSessionAnalysis([
      answer({
        analysisStatus: 'no_provenance',
        errorTags: [{ dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 9 }],
      }),
    ])
    expect(r.errorsByDimension.accuracy).toBe(0)
    expect(r.errorsByType).toEqual([])
  })

  it('tallies errorsByDimension across analyzed answers', () => {
    const r = rollupSessionAnalysis([
      answer({ errorTags: [{ dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 5 }] }),
      answer({ errorTags: [{ dimension: 'accuracy', type: 'factual_error', klpId: 'klp-b', significance: 2 }] }),
      answer({ errorTags: [{ dimension: 'clarity', type: 'hedging', klpId: null, significance: 3 }] }),
    ])
    expect(r.errorsByDimension).toEqual({ accuracy: 2, clarity: 1, conciseness: 0 })
  })

  it('sorts errorsByType by count desc, ties broken by total significance', () => {
    const r = rollupSessionAnalysis([
      answer({ errorTags: [{ dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 9 }] }),
      answer({ errorTags: [{ dimension: 'accuracy', type: 'factual_error', klpId: 'klp-b', significance: 2 }] }),
      answer({ errorTags: [{ dimension: 'accuracy', type: 'factual_error', klpId: 'klp-b', significance: 2 }] }),
    ])
    expect(r.errorsByType[0]).toMatchObject({ type: 'factual_error', count: 2 })
    expect(r.errorsByType[1]).toMatchObject({ type: 'inversion', count: 1 })
  })

  it('groups struggledKlps by klpId across DIFFERENT answers, not per-question', () => {
    const r = rollupSessionAnalysis([
      answer({
        klpResults: [{ klpId: 'klp-a', status: 'failed' }],
        errorTags: [{ dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 5 }],
      }),
      answer({
        klpResults: [{ klpId: 'klp-a', status: 'failed' }],
        errorTags: [{ dimension: 'accuracy', type: 'factual_error', klpId: 'klp-a', significance: 3 }],
      }),
      answer({ klpResults: [{ klpId: 'klp-b', status: 'passed' }] }),
    ])
    expect(r.struggledKlps).toHaveLength(1)
    expect(r.struggledKlps[0]).toMatchObject({ klpId: 'klp-a', failCount: 2, totalSignificance: 8 })
  })

  it('does not count a passed or partial KLP result as a struggle', () => {
    const r = rollupSessionAnalysis([
      answer({ klpResults: [{ klpId: 'klp-a', status: 'passed' }] }),
      answer({ klpResults: [{ klpId: 'klp-b', status: 'partial' }] }),
    ])
    expect(r.struggledKlps).toEqual([])
  })

  it('caps struggledKlps at 5, keeping the highest failCount', () => {
    const answers = Array.from({ length: 7 }, (_, i) =>
      answer({ klpResults: [{ klpId: `klp-${i}`, status: 'failed' }] }),
    )
    const r = rollupSessionAnalysis(answers)
    expect(r.struggledKlps).toHaveLength(5)
  })

  it('handles an empty session', () => {
    const r = rollupSessionAnalysis([])
    expect(r).toEqual({
      analyzedCount: 0,
      totalCount: 0,
      errorsByDimension: { accuracy: 0, clarity: 0, conciseness: 0 },
      errorsByType: [],
      struggledKlps: [],
    })
  })
})
