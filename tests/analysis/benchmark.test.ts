import { describe, it, expect } from 'vitest'
import {
  isLevelsKind,
  GRADER_PANEL_LEVELS,
  GRADER_PANEL_MODES,
  GRADER_PANEL_KINDS,
  coverageScore,
  rankAgreement,
  adjacentGaps,
  shapeAgreement,
  unresolvedQuoteRate,
  toBenchKlpVerdicts,
  toBenchRelationVerdicts,
  toBenchFormVerdicts,
  readPanelResult,
  type PanelKlpVerdict,
  type PanelRelationVerdict,
  type PanelFormVerdict,
} from '@/lib/analysis/benchmark'

/**
 * Spec 5 §8: the grader benchmark scores in TypeScript, from the grader's
 * categorical verdicts on answers the adversary wrote with a stated intent.
 * No number here is an AI opinion, so every number here is testable on
 * hand-built inputs.
 */
describe('grader-panel vocabulary', () => {
  it('names the four levels in rank order, the four failure shapes and the five panel kinds', () => {
    expect(GRADER_PANEL_LEVELS).toEqual(['expert', 'competent', 'weak', 'wrong'])
    expect(GRADER_PANEL_MODES).toEqual(['gap', 'misconception', 'connectivity', 'template'])
    expect(GRADER_PANEL_KINDS).toEqual(['levels', 'modes', 'blind', 'bands', 'blind-bands'])
  })
})

describe('coverageScore', () => {
  it('is the credit-weighted share of the key points, via STATUS_CREDIT', () => {
    // weights 3 + 1 + 1 = 5; credit 3*1 + 1*0.5 + 1*0 = 3.5
    expect(coverageScore([
      { status: 'correct', weight: 3 },
      { status: 'partial', weight: 1 },
      { status: 'omission', weight: 1 },
    ])).toBeCloseTo(0.7)
  })

  it('reads every wrong-model label as zero and the legacy alias as full credit', () => {
    expect(coverageScore([
      { status: 'contradicted', weight: 2 },
      { status: 'inversion', weight: 2 },
      { status: 'passed', weight: 1 },
    ])).toBeCloseTo(0.2)
  })

  it('is 0 on no verdicts and never NaN on a label outside the vocabulary', () => {
    expect(coverageScore([])).toBe(0)
    expect(coverageScore([{ status: 'nonsense', weight: 5 }])).toBe(0)
  })

  it('counts an unjudged key point at 0 credit in the denominator — one correct of seven is 1/7, not 1.0', () => {
    // FINAL REVIEW finding (5): a grader that returned a verdict for one of
    // seven points, and got it right, scored a perfect 1.0. Silence is not
    // coverage.
    const unjudged = Array.from({ length: 6 }, (_, i) => ({ klpId: `k${i + 1}`, weight: 1 }))
    expect(coverageScore([{ status: 'correct', weight: 1 }], unjudged)).toBeCloseTo(1 / 7, 6)
    // By WEIGHT: a heavy unjudged point costs more than a light one.
    expect(coverageScore([{ status: 'correct', weight: 1 }], [{ weight: 4 }])).toBeCloseTo(0.2, 6)
    // Nothing judged at all: 0, not NaN.
    expect(coverageScore([], unjudged)).toBe(0)
  })
})

describe('rankAgreement', () => {
  const perfect = [
    { intendedRank: 1, score: 1 },
    { intendedRank: 2, score: 0.8 },
    { intendedRank: 3, score: 0.5 },
    { intendedRank: 4, score: 0.1 },
  ]

  it('is 6/6 with no inversions on a perfect order', () => {
    expect(rankAgreement(perfect)).toEqual({ agreed: 6, total: 6, inversions: [] })
  })

  it('is 5/6 on one swapped pair and names that pair by intended rank', () => {
    // competent (rank 2) outscored by weak (rank 3)
    const r = rankAgreement([
      { intendedRank: 1, score: 1 },
      { intendedRank: 2, score: 0.4 },
      { intendedRank: 3, score: 0.5 },
      { intendedRank: 4, score: 0.1 },
    ])
    expect(r.agreed).toBe(5)
    expect(r.total).toBe(6)
    expect(r.inversions).toEqual([[2, 3]])
  })

  it('counts a tie as a disagreement', () => {
    const r = rankAgreement([
      { intendedRank: 1, score: 0.9 },
      { intendedRank: 2, score: 0.9 },
      { intendedRank: 3, score: 0.5 },
      { intendedRank: 4, score: 0.1 },
    ])
    expect(r.agreed).toBe(5)
    expect(r.inversions).toEqual([[1, 2]])
  })

  it('does not depend on input order', () => {
    const shuffled = [perfect[2], perfect[0], perfect[3], perfect[1]]
    expect(rankAgreement(shuffled)).toEqual({ agreed: 6, total: 6, inversions: [] })
  })

  it('lists every inversion of a fully reversed panel, better rank first', () => {
    const r = rankAgreement(perfect.map((a) => ({ ...a, score: 1 - a.score })))
    expect(r.agreed).toBe(0)
    expect(r.inversions).toEqual([[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]])
  })

  it('has zero pairs on fewer than two answers', () => {
    expect(rankAgreement([])).toEqual({ agreed: 0, total: 0, inversions: [] })
    expect(rankAgreement([{ intendedRank: 1, score: 1 }])).toEqual({ agreed: 0, total: 0, inversions: [] })
  })
})

describe('adjacentGaps', () => {
  it('is the score distance between adjacent intended levels, in rank order', () => {
    const gaps = adjacentGaps([
      { intendedRank: 1, score: 1 },
      { intendedRank: 2, score: 0.8 },
      { intendedRank: 3, score: 0.5 },
      { intendedRank: 4, score: 0.1 },
    ])
    expect(gaps).toHaveLength(3)
    expect(gaps[0]).toBeCloseTo(0.2)
    expect(gaps[1]).toBeCloseTo(0.3)
    expect(gaps[2]).toBeCloseTo(0.4)
  })

  it('sorts by intended rank first, and a negative gap is an adjacent inversion', () => {
    const gaps = adjacentGaps([
      { intendedRank: 3, score: 0.5 },
      { intendedRank: 1, score: 1 },
      { intendedRank: 2, score: 0.4 },
    ])
    expect(gaps[0]).toBeCloseTo(0.6)
    expect(gaps[1]).toBeCloseTo(-0.1)
  })

  it('is empty on fewer than two answers', () => {
    expect(adjacentGaps([])).toEqual([])
  })
})

describe('shapeAgreement', () => {
  const met = { status: 'met' as const }
  const notMet = { status: 'not_met' as const }

  it('gap: omissions dominate the non-correct verdicts, nothing is contradicted', () => {
    const r = shapeAgreement({
      mode: 'gap',
      verdicts: [
        { status: 'correct', weight: 3 },
        { status: 'omission', weight: 3 },
        { status: 'omission', weight: 2 },
        { status: 'partial', weight: 1 },
      ],
      relationVerdicts: [{ status: 'correct' }],
      formVerdicts: [met],
    })
    expect(r).toEqual({ expected: 'gap', observed: 'gap', agreed: true })
  })

  it('misconception: any contradicted or inverted key point', () => {
    const r = shapeAgreement({
      mode: 'misconception',
      verdicts: [
        { status: 'correct', weight: 3 },
        { status: 'contradicted', weight: 3 },
        { status: 'correct', weight: 2 },
      ],
      relationVerdicts: [],
      formVerdicts: [],
    })
    expect(r).toEqual({ expected: 'misconception', observed: 'misconception', agreed: true })
    expect(shapeAgreement({
      mode: 'misconception',
      verdicts: [{ status: 'inversion', weight: 1 }, { status: 'correct', weight: 1 }],
      relationVerdicts: [],
      formVerdicts: [],
    }).observed).toBe('misconception')
  })

  it('connectivity: every key point correct but a relation omitted', () => {
    const r = shapeAgreement({
      mode: 'connectivity',
      verdicts: [
        { status: 'correct', weight: 3 },
        { status: 'correct', weight: 2 },
      ],
      relationVerdicts: [{ status: 'omission' }, { status: 'correct' }],
      formVerdicts: [met],
    })
    expect(r).toEqual({ expected: 'connectivity', observed: 'connectivity', agreed: true })
  })

  it('template: a form requirement failed with key-point coverage at or above 0.8', () => {
    const r = shapeAgreement({
      mode: 'template',
      verdicts: [
        { status: 'correct', weight: 3 },
        { status: 'correct', weight: 3 },
        { status: 'correct', weight: 2 },
        { status: 'omission', weight: 2 }, // coverage 0.8 exactly
      ],
      relationVerdicts: [{ status: 'correct' }],
      formVerdicts: [met, notMet],
    })
    expect(r).toEqual({ expected: 'template', observed: 'template', agreed: true })
  })

  it('reports disagreement, naming both the intended and the observed shape', () => {
    // The adversary meant a gap; the grader read a contradiction.
    const r = shapeAgreement({
      mode: 'gap',
      verdicts: [
        { status: 'omission', weight: 2 },
        { status: 'omission', weight: 2 },
        { status: 'contradicted', weight: 1 },
      ],
      relationVerdicts: [],
      formVerdicts: [],
    })
    expect(r).toEqual({ expected: 'gap', observed: 'misconception', agreed: false })
  })

  describe('precedence', () => {
    it('misconception beats gap when both apply', () => {
      expect(shapeAgreement({
        mode: 'misconception',
        verdicts: [
          { status: 'omission', weight: 1 },
          { status: 'omission', weight: 1 },
          { status: 'omission', weight: 1 },
          { status: 'contradicted', weight: 1 },
        ],
        relationVerdicts: [],
        formVerdicts: [],
      }).observed).toBe('misconception')
    })

    it('template beats gap at high coverage — a fluent near-complete answer that fails a form rule is not a small gap', () => {
      expect(shapeAgreement({
        mode: 'template',
        verdicts: [
          { status: 'correct', weight: 5 },
          { status: 'correct', weight: 5 },
          { status: 'omission', weight: 1 },
        ],
        relationVerdicts: [],
        formVerdicts: [notMet],
      }).observed).toBe('template')
    })

    it('connectivity beats template when every key point is correct', () => {
      expect(shapeAgreement({
        mode: 'connectivity',
        verdicts: [{ status: 'correct', weight: 1 }],
        relationVerdicts: [{ status: 'omission' }],
        formVerdicts: [notMet],
      }).observed).toBe('connectivity')
    })

    it('a form failure at low coverage is not template — the gap check still runs', () => {
      expect(shapeAgreement({
        mode: 'template',
        verdicts: [
          { status: 'correct', weight: 1 },
          { status: 'omission', weight: 1 },
          { status: 'omission', weight: 1 },
        ],
        relationVerdicts: [],
        formVerdicts: [notMet],
      })).toEqual({ expected: 'template', observed: 'gap', agreed: false })
    })
  })

  it('none: an answer with partials only, no omission, contradiction, relation gap or form failure', () => {
    expect(shapeAgreement({
      mode: 'gap',
      verdicts: [{ status: 'partial', weight: 1 }, { status: 'correct', weight: 1 }],
      relationVerdicts: [{ status: 'correct' }],
      formVerdicts: [met],
    })).toEqual({ expected: 'gap', observed: 'none', agreed: false })
  })

  it('none: an answer the grader passed entirely', () => {
    expect(shapeAgreement({
      mode: 'connectivity',
      verdicts: [{ status: 'correct', weight: 1 }],
      relationVerdicts: [{ status: 'correct' }],
      formVerdicts: [met],
    }).observed).toBe('none')
  })
})

describe('unresolvedQuoteRate', () => {
  it('divides unresolved quotes by every quote the grader wrote, across all three verdict lists', () => {
    const r = unresolvedQuoteRate([
      {
        unresolvedQuotes: 1,
        verdicts: [{ quote: 'a' }, { quote: 'b' }, {}],
        relationVerdicts: [{ quote: 'c' }],
        formVerdicts: [{ quote: '' }],
      },
      {
        unresolvedQuotes: 2,
        verdicts: [{ quote: 'd' }, { quote: 'e' }],
        relationVerdicts: [],
        formVerdicts: [{ quote: 'f' }],
      },
    ])
    expect(r).toEqual({ unresolved: 3, quotes: 6, rate: 0.5 })
  })

  it('is 0 with no quotes at all, never NaN', () => {
    expect(unresolvedQuoteRate([])).toEqual({ unresolved: 0, quotes: 0, rate: 0 })
    expect(unresolvedQuoteRate([{ unresolvedQuotes: 0, verdicts: [{}], relationVerdicts: [], formVerdicts: [] }]).rate).toBe(0)
  })
})

/**
 * The persisted entry shapes on `GraderPanelResult` (controller ruling, Task
 * 11): a key-point entry is `{ klpRef, klpId, status, weight, quote?, spanStart,
 * spanEnd }`, a relation entry `{ relationRef, relationId, status, quote?,
 * spanStart, spanEnd }`, a form entry `{ formRef, formRequirementId, status,
 * quote?, spanStart, spanEnd }`. The converters narrow them to what the
 * scoring functions read, so a score is computable from the row alone.
 */
describe('panel verdict converters', () => {
  const klp: PanelKlpVerdict = { klpRef: 0, klpId: 'k0', status: 'partial', weight: 3, quote: 'x', spanStart: 0, spanEnd: 1 }
  const rel: PanelRelationVerdict = { relationRef: 0, relationId: 'r0', status: 'omission', spanStart: null, spanEnd: null }
  const form: PanelFormVerdict = { formRef: 0, formRequirementId: 'f0', status: 'not_met', quote: 'y', spanStart: null, spanEnd: null }

  it('narrow a persisted entry to the scoring shape, keeping status, weight and quote', () => {
    expect(toBenchKlpVerdicts([klp])).toEqual([{ status: 'partial', weight: 3, quote: 'x' }])
    expect(toBenchRelationVerdicts([rel])).toEqual([{ status: 'omission', quote: undefined }])
    expect(toBenchFormVerdicts([form])).toEqual([{ status: 'not_met', quote: 'y' }])
  })

  it('feed the scoring functions directly', () => {
    expect(coverageScore(toBenchKlpVerdicts([klp, { ...klp, klpRef: 1, klpId: 'k1', status: 'correct', weight: 1 }]))).toBeCloseTo(2.5 / 4, 6)
    expect(shapeAgreement({
      mode: 'template',
      verdicts: toBenchKlpVerdicts([{ ...klp, status: 'correct' }]),
      relationVerdicts: toBenchRelationVerdicts([]),
      formVerdicts: toBenchFormVerdicts([form]),
    }).agreed).toBe(true)
  })

  it('readPanelResult validates the three Json columns of a stored row', () => {
    const row = readPanelResult({
      verdicts: [klp],
      relationVerdicts: [rel],
      formVerdicts: [form],
      unresolvedQuotes: 1,
      judgedOf: 3,
      unjudged: [{ klpId: 'k1', weight: 2 }, { klpId: 'k2', weight: 1 }],
    })
    expect(row.verdicts).toEqual([klp])
    expect(row.relationVerdicts).toEqual([rel])
    expect(row.formVerdicts).toEqual([form])
    expect(row.unresolvedQuotes).toBe(1)
    expect(row.judgedOf).toBe(3)
    expect(row.unjudged).toEqual([{ klpId: 'k1', weight: 2 }, { klpId: 'k2', weight: 1 }])
    expect(unresolvedQuoteRate([row])).toEqual({ unresolved: 1, quotes: 2, rate: 0.5 })
    // And the score reads the row alone: 0.5*3 earned of 3+2+1 possible.
    expect(coverageScore(toBenchKlpVerdicts(row.verdicts), row.unjudged)).toBeCloseTo(1.5 / 6, 6)
  })

  it('readPanelResult tolerates a row written before judgedOf/unjudged existed', () => {
    // Column defaults are 0 / `[]`; an older reader shape passes neither.
    // Either reads as "every verdict was judged, nothing missing".
    const legacy = readPanelResult({ verdicts: [klp], relationVerdicts: [], formVerdicts: [], unresolvedQuotes: 0 })
    expect(legacy.judgedOf).toBe(1)
    expect(legacy.unjudged).toEqual([])
    const defaulted = readPanelResult({ verdicts: [klp], relationVerdicts: [], formVerdicts: [], unresolvedQuotes: 0, judgedOf: 0, unjudged: [] })
    expect(defaulted.judgedOf).toBe(1)
    expect(defaulted.unjudged).toEqual([])
  })

  it('readPanelResult refuses a malformed column rather than scoring garbage as zero', () => {
    expect(() => readPanelResult({ verdicts: [{ status: 'correct' }], relationVerdicts: [], formVerdicts: [], unresolvedQuotes: 0 })).toThrow(/verdicts/)
    expect(() => readPanelResult({ verdicts: 'nope', relationVerdicts: [], formVerdicts: [], unresolvedQuotes: 0 })).toThrow()
    expect(() => readPanelResult({ verdicts: [], relationVerdicts: [], formVerdicts: [{ ...form, status: 'maybe' }], unresolvedQuotes: 0 })).toThrow(/formVerdicts/)
    expect(() => readPanelResult({ verdicts: [], relationVerdicts: [], formVerdicts: [], unresolvedQuotes: 0, unjudged: [{ klpId: 'k' }] })).toThrow(/unjudged/)
  })
})

describe('the blind panel kind (2026-09-18)', () => {
  it('is levels-shaped for scoring, and modes is not', () => {
    expect(isLevelsKind('levels')).toBe(true)
    expect(isLevelsKind('blind')).toBe(true)
    expect(isLevelsKind('modes')).toBe(false)
  })
})
