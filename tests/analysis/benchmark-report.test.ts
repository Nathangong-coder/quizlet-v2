import { describe, it, expect } from 'vitest'
import { formatBenchmarkReport, summarizeBenchmark, type BenchmarkCardRow, type ReportAnswer } from '@/lib/analysis/benchmark-report'
import type { PanelKlpVerdict } from '@/lib/analysis/benchmark'

/**
 * Spec 5 §8 — the benchmark REPORT. A pure text formatter over the rows
 * `npm run bench-grader` (and the end of `author-klps`) reads: per card the
 * rank agreement as `n/6`, the adjacent gaps, every inverted pair with the
 * adversary's rationale beside the grader's verdicts, a shape matrix for
 * `modes` panels, the unresolved-quote rate, and totals. Nothing here is a
 * number the scoring module did not already compute.
 */

function klp(klpRef: number, status: string, weight = 1, quote?: string): PanelKlpVerdict {
  const resolved = quote !== undefined && !quote.startsWith('~')
  return {
    klpRef,
    klpId: `klp-${klpRef}`,
    status,
    weight,
    ...(quote !== undefined ? { quote } : {}),
    spanStart: resolved ? 0 : null,
    spanEnd: resolved ? quote!.length : null,
  }
}

function levelAnswer(
  level: 'expert' | 'competent' | 'weak' | 'wrong',
  verdicts: PanelKlpVerdict[],
  rationale: string,
  extra: Partial<NonNullable<ReportAnswer['result']>> = {},
): ReportAnswer {
  const rank = { expert: 1, competent: 2, weak: 3, wrong: 4 }[level]
  return {
    id: `ans-${level}`,
    level,
    mode: null,
    intendedRank: rank,
    rationale,
    result: {
      model: 'deepseek-v4-flash',
      graderVersion: 1,
      verdicts,
      relationVerdicts: [],
      formVerdicts: [],
      unresolvedQuotes: verdicts.filter((v) => v.quote !== undefined && v.spanStart === null).length,
      ...extra,
    },
  }
}

/** Card 1: a clean 6/6 with healthy gaps. */
const cleanCard: BenchmarkCardRow = {
  cardId: 'card-1',
  term: 'Sources and uses',
  kind: 'levels',
  klpVersion: 3,
  answers: [
    levelAnswer('expert', [klp(0, 'correct', 1, 'debt funds'), klp(1, 'correct', 1, 'equity plugs'), klp(2, 'correct')], 'Nails [0] [1] [2].\nSecond line.'),
    levelAnswer('competent', [klp(0, 'correct', 1, 'debt funds'), klp(1, 'partial', 1, 'some equity'), klp(2, 'correct')], 'Fudges [1].'),
    levelAnswer('weak', [klp(0, 'correct', 1, 'debt'), klp(1, 'omission'), klp(2, 'omission')], 'Omits [1] and [2].'),
    levelAnswer('wrong', [klp(0, 'contradicted', 1, 'equity funds'), klp(1, 'omission'), klp(2, 'omission')], 'Inverts [0].'),
  ],
}

/** Card 2: competent and weak are inverted; one quote unresolved. */
const invertedCard: BenchmarkCardRow = {
  cardId: 'card-2',
  term: 'Exit multiple',
  kind: 'levels',
  klpVersion: 2,
  answers: [
    levelAnswer('expert', [klp(0, 'correct', 2, 'EV over EBITDA'), klp(1, 'correct', 1, 'at exit')], 'Complete on both points.\nMore detail here.'),
    levelAnswer('competent', [klp(0, 'partial', 2, '~paraphrased quote'), klp(1, 'correct', 1, 'at exit')], 'Imprecise on [0]: names the ratio but not the year.\nIt still states [1].'),
    levelAnswer('weak', [klp(0, 'correct', 2, 'EV over EBITDA'), klp(1, 'omission')], 'Omits [1] entirely; [0] is stated by rote.\nThin.'),
    levelAnswer('wrong', [klp(0, 'inversion', 2, 'EBITDA over EV'), klp(1, 'omission')], 'Inverts [0].'),
  ],
}

describe('formatBenchmarkReport — levels panels', () => {
  const report = formatBenchmarkReport([cleanCard, invertedCard])

  it('prints each card with its rank agreement as n/6', () => {
    expect(report).toContain('Sources and uses')
    expect(report).toMatch(/Sources and uses.*rank agreement 6\/6/)
    expect(report).toMatch(/Exit multiple.*rank agreement 5\/6/)
  })

  it('prints the adjacent gaps and their mean per card', () => {
    // clean card: expert 1.00, competent 0.833, weak 0.333, wrong 0.0
    expect(report).toMatch(/Sources and uses.*gaps 0\.17 \/ 0\.50 \/ 0\.33/)
    // inverted card: expert 1.00, competent 0.667, weak 0.667, wrong 0.0 → 0.33 / 0.00 / 0.67
    expect(report).toMatch(/Exit multiple.*gaps 0\.33 \/ 0\.00 \/ 0\.67/)
  })

  it('lists an inversion with the first line of both rationales and the grader verdicts', () => {
    const lines = report.split('\n')
    const at = lines.findIndex((l) => /INVERSION/.test(l))
    expect(at).toBeGreaterThan(0)
    expect(lines[at]).toMatch(/competent.*rank 2.*0\.67.*weak.*rank 3.*0\.67/)
    const block = lines.slice(at, at + 5).join('\n')
    // First line of each rationale, never the second.
    expect(block).toContain('Imprecise on [0]: names the ratio but not the year.')
    expect(block).not.toContain('It still states [1].')
    expect(block).toContain('Omits [1] entirely; [0] is stated by rote.')
    expect(block).not.toContain('Thin.')
    // The grader's verdicts beside them, with the quotes it gave.
    expect(block).toMatch(/grader.*competent.*\[0\] partial/)
    expect(block).toMatch(/grader.*weak.*\[1\] omission/)
    expect(block).toContain('"at exit"')
  })

  it('does not list an inversion for a card at 6/6', () => {
    const cleanOnly = formatBenchmarkReport([cleanCard])
    expect(cleanOnly).not.toContain('INVERSION')
  })

  it('prints the unresolved-quote rate per card and in total', () => {
    // inverted card: 6 quotes, 1 unresolved; clean card: 6 quotes, 0 unresolved → 1/12
    expect(report).toMatch(/Exit multiple.*quotes 1\/6 unresolved/)
    expect(report).toMatch(/unresolved quotes 1\/12 \(8\.3%\)/)
  })

  it('prints the totals: pooled rank agreement, cards at 6/6, mean adjacent gap, grader version and models', () => {
    expect(report).toMatch(/rank agreement 11\/12 \(91\.7%\)/)
    expect(report).toMatch(/1\/2 card\(s\) at 6\/6/)
    // gaps: (0.167+0.5+0.333 + 0.333+0+0.667)/6 = 0.333
    expect(report).toMatch(/mean adjacent gap 0\.33/)
    expect(report).toContain('grader v1')
    expect(report).toContain('deepseek-v4-flash')
  })

  it('names an answer with no result as ungraded and excludes the card from rank agreement', () => {
    const partial: BenchmarkCardRow = {
      ...cleanCard,
      cardId: 'card-3',
      term: 'Half graded',
      answers: cleanCard.answers.map((a, i) => (i === 3 ? { ...a, result: null } : a)),
    }
    const out = formatBenchmarkReport([partial])
    expect(out).toMatch(/Half graded.*ungraded 1\/4/)
    expect(out).not.toMatch(/Half graded.*rank agreement/)
    expect(out).toMatch(/ungraded answers: 1/)
  })

  it('handles an empty run without dividing by zero', () => {
    const out = formatBenchmarkReport([])
    expect(out).toContain('no panels')
    expect(out).not.toContain('NaN')
  })

  it('a compact report keeps the per-card line and totals but drops the inversion detail', () => {
    const compact = formatBenchmarkReport([cleanCard, invertedCard], { verbose: false })
    expect(compact).toMatch(/Exit multiple.*rank agreement 5\/6/)
    expect(compact).toContain('INVERSION')
    expect(compact).not.toContain('adversary')
    expect(compact).toMatch(/rank agreement 11\/12/)
  })
})

describe('formatBenchmarkReport — modes panels', () => {
  function modeAnswer(mode: string, verdicts: PanelKlpVerdict[], opts: { relationOmission?: boolean; formNotMet?: boolean } = {}): ReportAnswer {
    return {
      id: `ans-${mode}`,
      level: null,
      mode,
      intendedRank: ['gap', 'connectivity', 'template', 'misconception'].indexOf(mode) + 1,
      rationale: `Written as ${mode}.`,
      result: {
        model: 'deepseek-v4-flash',
        graderVersion: 1,
        verdicts,
        relationVerdicts: opts.relationOmission
          ? [{ relationRef: 0, relationId: 'rel-0', status: 'omission', spanStart: null, spanEnd: null }]
          : [],
        formVerdicts: opts.formNotMet
          ? [{ formRef: 0, formRequirementId: 'form-0', status: 'not_met', spanStart: null, spanEnd: null }]
          : [],
        unresolvedQuotes: 0,
      },
    }
  }
  const modesCard: BenchmarkCardRow = {
    cardId: 'card-m',
    term: 'Debt paydown',
    kind: 'modes',
    klpVersion: 1,
    answers: [
      modeAnswer('gap', [klp(0, 'correct'), klp(1, 'omission'), klp(2, 'omission')]),
      // The misconception answer read as a gap — a named confusion cell.
      modeAnswer('misconception', [klp(0, 'correct'), klp(1, 'omission'), klp(2, 'correct')]),
      modeAnswer('connectivity', [klp(0, 'correct'), klp(1, 'correct'), klp(2, 'correct')], { relationOmission: true }),
      modeAnswer('template', [klp(0, 'correct'), klp(1, 'correct'), klp(2, 'correct')], { formNotMet: true }),
    ],
  }

  it('prints shape agreement per card and a confusion matrix with both names on a miss', () => {
    const out = formatBenchmarkReport([modesCard])
    expect(out).toMatch(/Debt paydown.*shape agreement 3\/4/)
    expect(out).toMatch(/misconception -> gap/)
    expect(out).toContain('shape matrix')
    // Matrix rows are the expected shapes; the misconception row has its hit under `gap`.
    const summary = summarizeBenchmark([modesCard])
    expect(summary.shapeMatrix.misconception.gap).toBe(1)
    expect(summary.shapeMatrix.gap.gap).toBe(1)
    expect(summary.shapeMatrix.connectivity.connectivity).toBe(1)
    expect(summary.shapeMatrix.template.template).toBe(1)
    expect(summary.shapeAgreed).toBe(3)
    expect(summary.shapeTotal).toBe(4)
  })
})

describe('summarizeBenchmark', () => {
  it('pools the numbers the report prints', () => {
    const s = summarizeBenchmark([cleanCard, invertedCard])
    expect(s.levelsCards).toBe(2)
    expect(s.modesCards).toBe(0)
    expect(s.rankAgreed).toBe(11)
    expect(s.rankTotal).toBe(12)
    expect(s.perfectCards).toBe(1)
    expect(s.meanAdjacentGap).toBeCloseTo(1 / 3, 5)
    expect(s.quotes).toEqual({ unresolved: 1, quotes: 12, rate: 1 / 12 })
    expect(s.models).toEqual(['deepseek-v4-flash'])
    expect(s.graderVersions).toEqual([1])
    expect(s.ungraded).toBe(0)
  })

  it('a card with an ungraded answer counts toward ungraded and not toward rank agreement', () => {
    const partial: BenchmarkCardRow = {
      ...cleanCard,
      answers: cleanCard.answers.map((a, i) => (i === 0 ? { ...a, result: null } : a)),
    }
    const s = summarizeBenchmark([partial])
    expect(s.ungraded).toBe(1)
    expect(s.rankTotal).toBe(0)
    expect(s.meanAdjacentGap).toBeNull()
  })
})
