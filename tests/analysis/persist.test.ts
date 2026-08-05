import { describe, it, expect } from 'vitest'
import { buildAnalysisWrites } from '@/lib/analysis/persist'

const klps = [
  { id: 'klp-a', weight: 5 },
  { id: 'klp-b', weight: 3 },
]

const base = {
  mode: 'quiz-sa' as const,
  klps,
  starred: false,
  klpResults: [],
  errorTags: [],
}

describe('buildAnalysisWrites — KLP results', () => {
  it('resolves a ref to a real id and computes credit', () => {
    const w = buildAnalysisWrites({
      ...base,
      klpResults: [{ klpRef: 0, status: 'passed', evidence: 'said it plainly' }],
    })
    expect(w.klpResults).toEqual([
      { klpId: 'klp-a', status: 'passed', credit: 0.95, mode: 'quiz-sa', evidence: 'said it plainly' },
    ])
  })

  it('drops a result whose ref does not resolve, and warns', () => {
    const w = buildAnalysisWrites({
      ...base,
      klpResults: [{ klpRef: 7, status: 'failed' }],
    })
    expect(w.klpResults).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'unresolved_klp_ref', value: '7' })
  })

  it('gives a failed status zero credit, short-circuiting before mode', () => {
    for (const mode of ['quiz-sa', 'quiz-mc', 'quiz-tf'] as const) {
      const w = buildAnalysisWrites({ ...base, mode, klpResults: [{ klpRef: 0, status: 'failed' }] })
      expect(w.klpResults[0].credit).toBe(0)
    }
  })

  it('scales a passed credit by the mode, which is where mode actually matters', () => {
    const sa = buildAnalysisWrites({ ...base, mode: 'quiz-sa', klpResults: [{ klpRef: 0, status: 'passed' }] })
    const tf = buildAnalysisWrites({ ...base, mode: 'quiz-tf', klpResults: [{ klpRef: 0, status: 'passed' }] })
    expect(sa.klpResults[0].credit).toBeCloseTo(0.95)
    expect(tf.klpResults[0].credit).toBeCloseTo(0.5)
    expect(sa.klpResults[0].credit).toBeGreaterThan(tf.klpResults[0].credit)
  })
})

describe('buildAnalysisWrites — error tags', () => {
  const tag = { dimension: 'accuracy' as const, type: 'inversion', klpRef: 0, severity: 4 }

  it('computes significance from the KLP weight, not the model', () => {
    const w = buildAnalysisWrites({ ...base, errorTags: [tag] })
    expect(w.errorTags).toHaveLength(1)
    expect(w.errorTags[0]).toMatchObject({
      dimension: 'accuracy', type: 'inversion', klpId: 'klp-a',
      relevance: 5, severity: 4, starred: false,
    })
    // relevance 5 (klp-a's weight), severity 4, accuracy (1.0), unstarred:
    // (0.55*5 + 0.45*4) * 2 * 1.0 * 1 = 9.1 -> 9
    expect(w.errorTags[0].significance).toBe(9)
  })

  it('drops a tag with an unknown dimension, and warns', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ dimension: 'delivery' as never, type: 'inversion', klpRef: 0, severity: 3 }],
    })
    expect(w.errorTags).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'unknown_dimension', value: 'delivery' })
  })

  it('drops a tag whose type is not in its dimension, and warns', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ ...tag, dimension: 'clarity', type: 'inversion' }],
    })
    expect(w.errorTags).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'invalid_type_for_dimension', value: 'clarity/inversion' })
  })

  it('drops a tag with an unknown type, and warns', () => {
    const w = buildAnalysisWrites({ ...base, errorTags: [{ ...tag, type: 'vibes' }] })
    expect(w.errorTags).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'unknown_type', value: 'vibes' })
  })

  it('keeps a whole-answer tag with no klpRef, using relevance 3', () => {
    // No KLP target means no stored weight to read; the midpoint is the only
    // defensible neutral, and it is recorded so it can be recomputed.
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ dimension: 'conciseness', type: 'rambling', severity: 3 }],
    })
    expect(w.errorTags[0]).toMatchObject({ klpId: null, relevance: 3 })
  })

  it('caps tags per dimension, keeping the most severe', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [
        { dimension: 'accuracy', type: 'omission', klpRef: 0, severity: 2 },
        { dimension: 'accuracy', type: 'inversion', klpRef: 0, severity: 5 },
        { dimension: 'accuracy', type: 'incomplete', klpRef: 1, severity: 4 },
      ],
    })
    expect(w.errorTags).toHaveLength(2)
    expect(w.errorTags.map((t) => t.severity)).toEqual([5, 4])
    expect(w.warnings).toContainEqual({ reason: 'dimension_cap', value: 'accuracy' })
  })

  it('does NOT warn when a dimension reaches the cap without exceeding it', () => {
    // Exactly MAX_TAGS_PER_DIMENSION. The warning means "we dropped something",
    // so firing it here would make a clean answer look lossy.
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [
        { dimension: 'accuracy', type: 'omission', klpRef: 0, severity: 3 },
        { dimension: 'accuracy', type: 'inversion', klpRef: 1, severity: 4 },
      ],
    })
    expect(w.errorTags).toHaveLength(2)
    expect(w.warnings).not.toContainEqual({ reason: 'dimension_cap', value: 'accuracy' })
  })

  it('carries secondaryKlpId for conflation', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ dimension: 'accuracy', type: 'conflation', klpRef: 0, secondaryKlpRef: 1, severity: 5 }],
    })
    expect(w.errorTags[0]).toMatchObject({ klpId: 'klp-a', secondaryKlpId: 'klp-b' })
  })
})

describe('buildAnalysisWrites — status', () => {
  it('is analyzed when nothing was rejected', () => {
    expect(buildAnalysisWrites(base).status).toBe('analyzed')
  })

  it('stays analyzed when a tag was dropped — lossiness is a SEPARATE axis', () => {
    // "did we analyze" and "was the analysis lossy" are independent. Folding a
    // 'partial' status in would make "no_klps AND two tags rejected"
    // inexpressible.
    const w = buildAnalysisWrites({ ...base, errorTags: [{ dimension: 'accuracy', type: 'vibes', severity: 3 }] })
    expect(w.status).toBe('analyzed')
    expect(w.warnings.length).toBeGreaterThan(0)
  })

  it('is no_klps when the card has none', () => {
    const w = buildAnalysisWrites({ ...base, klps: [] })
    expect(w.status).toBe('no_klps')
    expect(w.klpResults).toEqual([])
  })

  it('lets forcedStatus override the derived status', () => {
    // Task 10 uses this for a legacy cache row with no distractor provenance.
    // Without the override such an answer records as `analyzed` — an answer
    // nobody could analyze, counted as a clean one.
    const w = buildAnalysisWrites({ ...base, forcedStatus: 'no_provenance' })
    expect(w.status).toBe('no_provenance')
  })

  it('lets forcedStatus win even when the card genuinely has no KLPs', () => {
    const w = buildAnalysisWrites({ ...base, klps: [], forcedStatus: 'failed' })
    expect(w.status).toBe('failed')
  })
})
