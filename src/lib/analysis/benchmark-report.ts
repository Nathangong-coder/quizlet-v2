import { answerScore, compositionOf, type VerdictComposition } from '@/lib/analysis/scoring-rules'
import {
  GRADER_PANEL_MODES,
  adjacentGaps,
  coverageScore,
  rankAgreement,
  shapeAgreement,
  toBenchFormVerdicts,
  toBenchKlpVerdicts,
  toBenchRelationVerdicts,
  unresolvedQuoteRate,
  type ObservedShape,
  type PanelResultLists,
  type UnresolvedQuoteRate,
  isLevelsKind,
  isBandsKind,
  bandHit,
  type GraderPanelKind,
} from '@/lib/analysis/benchmark'

/**
 * The grader benchmark REPORT (Spec 5 §8) — a pure text formatter over the
 * rows `npm run bench-grader` reads back, also printed at the end of
 * `author-klps` runs on a set that has panels.
 *
 * Kept apart from `benchmark.ts` on purpose. That module is the scoring —
 * every function there returns a number an operator could persist, test on
 * a hand-built verdict set, or hold a prompt version to; it never reads the
 * adversary's prose. This module reads the prose (a rationale's first line
 * beside an inverted pair) and renders strings, and it is the part that
 * grows — a per-model table, a matrix, a compact form for `author-klps` —
 * without moving a scoring test.
 *
 * NO NUMBER HERE IS NEW. `summarizeBenchmark` pools what `benchmark.ts`
 * computes per answer; `formatBenchmarkReport` prints it.
 */

export interface ReportResult extends PanelResultLists {
  model: string
  graderVersion: number
}

export interface ReportAnswer {
  id: string
  level: string | null
  mode: string | null
  intendedRank: number
  rationale: string
  /** The result this run reads for the answer, or null when it has none yet. */
  result: ReportResult | null
}

export interface BenchmarkCardRow {
  cardId: string
  term: string
  kind: GraderPanelKind
  klpVersion: number
  answers: ReportAnswer[]
  /**
   * Set when the card's results at this grader version are split across
   * models with no single model covering every answer (`selectCardResults`).
   * Such a card is named and excluded from every total: scoring it would fold
   * the gap between two graders into the gap between levels. Its `answers`
   * carry no `result`.
   */
  mixed?: string[]
}

export type ShapeMatrix = Record<string, Record<ObservedShape, number>>

export interface BenchmarkSummary {
  cards: number
  levelsCards: number
  modesCards: number
  /** Pooled pairwise rank agreement over every fully graded `levels` card. */
  rankAgreed: number
  rankTotal: number
  /** Fully graded `levels` cards at 6/6. */
  perfectCards: number
  /** Bands kinds only: answers whose score landed in the adversary's intended band. */
  bandHits: number
  bandTotal: number
  /** Mean of every adjacent gap over every fully graded `levels` card; null with none. */
  meanAdjacentGap: number | null
  adjacentInversions: number
  /** Fully graded `modes` cards' shape agreement, pooled, plus the confusion matrix. */
  shapeAgreed: number
  shapeTotal: number
  shapeMatrix: ShapeMatrix
  quotes: UnresolvedQuoteRate
  /**
   * Key points the grader returned no verdict for, pooled over every result
   * read, beside the number it was asked about. A grader that skips points
   * is a grader defect the coverage score now counts against it (at 0), and
   * the pair says how often it happens.
   */
  unjudged: { unjudged: number; judgedOf: number }
  /** Answers with no result. A card with one is excluded from the rank and shape numbers. */
  ungraded: number
  /** Cards excluded because their results are split across models — see `BenchmarkCardRow.mixed`. */
  mixedCards: number
  models: string[]
  graderVersions: number[]
}

interface ScoredAnswer extends ReportAnswer {
  result: ReportResult
  /** `answerScore` — coverage MINUS the contradiction term (`GRADER_SCORING`). Rank agreement reads this. */
  score: number
  /** Holes only — the old rule, kept beside the score so the two axes stay readable. */
  coverage: number
  composition: VerdictComposition
}

function scored(row: BenchmarkCardRow): ScoredAnswer[] | null {
  const out: ScoredAnswer[] = []
  for (const a of row.answers) {
    if (!a.result) return null
    const verdicts = toBenchKlpVerdicts(a.result.verdicts)
    const relations = toBenchRelationVerdicts(a.result.relationVerdicts)
    out.push({
      ...a,
      result: a.result,
      score: answerScore(verdicts, relations, a.result.unjudged),
      coverage: coverageScore(verdicts, a.result.unjudged),
      composition: compositionOf(verdicts, relations, a.result.unjudged),
    })
  }
  return out
}

function compositionLine(c: VerdictComposition): string {
  const parts = [`${c.correct}✓`]
  if (c.partial) parts.push(`${c.partial}½`)
  if (c.missing) parts.push(`${c.missing} missing`)
  if (c.wrong) parts.push(`${c.wrong} WRONG`)
  if (c.relationsWrong) parts.push(`R${c.relationsWrong} wrong`)
  return parts.join(' ')
}

function emptyMatrix(): ShapeMatrix {
  const m: ShapeMatrix = {}
  for (const expected of GRADER_PANEL_MODES) {
    m[expected] = { gap: 0, misconception: 0, connectivity: 0, template: 0, none: 0 }
  }
  return m
}

function shapeOf(a: ScoredAnswer) {
  return shapeAgreement({
    mode: a.mode ?? '',
    verdicts: toBenchKlpVerdicts(a.result.verdicts),
    relationVerdicts: toBenchRelationVerdicts(a.result.relationVerdicts),
    formVerdicts: toBenchFormVerdicts(a.result.formVerdicts),
    unjudged: a.result.unjudged,
  })
}

export function summarizeBenchmark(rows: readonly BenchmarkCardRow[]): BenchmarkSummary {
  const s: BenchmarkSummary = {
    cards: rows.length,
    levelsCards: 0,
    modesCards: 0,
    rankAgreed: 0,
    rankTotal: 0,
    perfectCards: 0,
    bandHits: 0,
    bandTotal: 0,
    meanAdjacentGap: null,
    adjacentInversions: 0,
    shapeAgreed: 0,
    shapeTotal: 0,
    shapeMatrix: emptyMatrix(),
    quotes: { unresolved: 0, quotes: 0, rate: 0 },
    unjudged: { unjudged: 0, judgedOf: 0 },
    ungraded: 0,
    mixedCards: 0,
    models: [],
    graderVersions: [],
  }
  const models = new Set<string>()
  const versions = new Set<number>()
  const results: PanelResultLists[] = []
  let gapSum = 0
  let gapCount = 0

  for (const row of rows) {
    if (isLevelsKind(row.kind)) s.levelsCards++
    else if (row.kind === 'modes') s.modesCards++
    if (row.mixed) {
      s.mixedCards++
      continue
    }
    for (const a of row.answers) {
      if (!a.result) {
        s.ungraded++
        continue
      }
      results.push(a.result)
      models.add(a.result.model)
      versions.add(a.result.graderVersion)
      s.unjudged.unjudged += a.result.unjudged.length
      s.unjudged.judgedOf += a.result.judgedOf
    }
    const answers = scored(row)
    if (!answers) continue
    if (isLevelsKind(row.kind)) {
      const ra = rankAgreement(answers)
      s.rankAgreed += ra.agreed
      s.rankTotal += ra.total
      if (ra.total > 0 && ra.agreed === ra.total) s.perfectCards++
      if (isBandsKind(row.kind)) {
        for (const a of answers) {
          s.bandTotal++
          if (a.level && bandHit(a.level, a.score)) s.bandHits++
        }
      }
      for (const g of adjacentGaps(answers)) {
        gapSum += g
        gapCount++
        if (g < 0) s.adjacentInversions++
      }
    } else if (row.kind === 'modes') {
      for (const a of answers) {
        const sh = shapeOf(a)
        s.shapeTotal++
        if (sh.agreed) s.shapeAgreed++
        const rowOf = (s.shapeMatrix[sh.expected] ??= { gap: 0, misconception: 0, connectivity: 0, template: 0, none: 0 })
        rowOf[sh.observed]++
      }
    }
  }

  s.meanAdjacentGap = gapCount > 0 ? gapSum / gapCount : null
  s.quotes = unresolvedQuoteRate(results)
  s.models = [...models].sort()
  s.graderVersions = [...versions].sort((a, b) => a - b)
  return s
}

const f2 = (n: number) => n.toFixed(2)
const pct = (num: number, den: number) => (den > 0 ? `${((100 * num) / den).toFixed(1)}%` : 'n/a')
const firstLine = (text: string) => text.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? ''

function quoteCount(r: PanelResultLists): number {
  let n = 0
  for (const list of [r.verdicts, r.relationVerdicts, r.formVerdicts]) {
    for (const v of list) if (typeof v.quote === 'string' && v.quote.length > 0) n++
  }
  return n
}

const clip = (s: string, max = 48) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** `[0] partial "quote" · [1] omission · [R0] omission · [F0] not_met` — the grader's read of one answer. */
function graderLine(r: PanelResultLists): string {
  const parts: string[] = []
  for (const v of r.verdicts) parts.push(`[${v.klpRef}] ${v.status}${v.quote ? ` "${clip(v.quote)}"` : ''}`)
  for (const v of r.relationVerdicts) parts.push(`[R${v.relationRef}] ${v.status}${v.quote ? ` "${clip(v.quote)}"` : ''}`)
  for (const v of r.formVerdicts) parts.push(`[F${v.formRef}] ${v.status}${v.quote ? ` "${clip(v.quote)}"` : ''}`)
  return parts.length > 0 ? parts.join(' · ') : '(no per-point verdicts)'
}

const labelOf = (a: ReportAnswer) => a.level ?? a.mode ?? `rank ${a.intendedRank}`

export interface FormatBenchmarkOptions {
  /** A title for the header line — the set's title, typically. */
  title?: string
  /**
   * `false` prints the per-card line and the totals only — the form
   * `author-klps` prints beside its histogram. `true` (default) adds each
   * inverted pair's adversary rationale and grader verdicts, and each
   * `modes` card's per-answer shape read.
   */
  verbose?: boolean
}

/**
 * The report. Per card: rank agreement as `n/6`, the adjacent gaps, the
 * unresolved-quote count, each score by level; every inverted pair with
 * the first line of BOTH rationales and the grader's verdicts on both
 * answers (that pairing is the whole reason the rationale is persisted); a
 * `modes` card's shape reads; then the pooled totals and the shape matrix.
 */
export function formatBenchmarkReport(rows: readonly BenchmarkCardRow[], opts: FormatBenchmarkOptions = {}): string {
  const verbose = opts.verbose ?? true
  const s = summarizeBenchmark(rows)
  const lines: string[] = []
  const title = opts.title ? ` "${opts.title}"` : ''

  if (rows.length === 0) {
    lines.push(`=== Grader benchmark${title}: no panels — run with --author to write them ===`)
    return lines.join('\n')
  }

  lines.push(
    `=== Grader benchmark${title}: ${s.cards} card(s) — levels ${s.levelsCards}, modes ${s.modesCards}; ` +
      `grader ${s.graderVersions.length > 0 ? s.graderVersions.map((v) => `v${v}`).join(', ') : 'n/a'}; ` +
      `model(s): ${s.models.length > 0 ? s.models.join(', ') : 'none'} ===`,
  )

  for (const row of rows) {
    const head = `${row.term}  [${row.kind} v${row.klpVersion}]`
    if (row.mixed) {
      lines.push(`${head}  MIXED — results on ${row.mixed.join(', ')}; not scored (re-run with --model <id> to complete one)`)
      continue
    }
    const answers = scored(row)
    if (!answers) {
      const missing = row.answers.filter((a) => !a.result).length
      lines.push(`${head}  ungraded ${missing}/${row.answers.length} — not scored`)
      continue
    }
    const quotes = answers.reduce((n, a) => n + quoteCount(a.result), 0)
    const unresolved = answers.reduce((n, a) => n + a.result.unresolvedQuotes, 0)
    const unjudged = answers.reduce((n, a) => n + a.result.unjudged.length, 0)
    const judgedOf = answers.reduce((n, a) => n + a.result.judgedOf, 0)
    const byRank = [...answers].sort((a, b) => a.intendedRank - b.intendedRank)

    if (isLevelsKind(row.kind)) {
      const ra = rankAgreement(answers)
      const gaps = adjacentGaps(answers)
      const meanGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
      lines.push(
        `${head}  rank agreement ${ra.agreed}/${ra.total}  gaps ${gaps.map(f2).join(' / ')} (mean ${f2(meanGap)})  ` +
          `quotes ${unresolved}/${quotes} unresolved  unjudged ${unjudged}/${judgedOf}`,
      )
      lines.push(`  ${byRank.map((a) => `${labelOf(a)} ${f2(a.score)}${isBandsKind(row.kind) && a.level ? (bandHit(a.level, a.score) ? ' ✓band' : ' ✗band') : ''} (cov ${f2(a.coverage)}; ${compositionLine(a.composition)})`).join(' · ')}`)
      for (const [better, worse] of ra.inversions) {
        const b = byRank.find((a) => a.intendedRank === better)!
        const w = byRank.find((a) => a.intendedRank === worse)!
        lines.push(`  INVERSION ${labelOf(b)} (rank ${better}) ${f2(b.score)} <= ${labelOf(w)} (rank ${worse}) ${f2(w.score)}`)
        if (!verbose) continue
        lines.push(`    adversary on ${labelOf(b)}: ${firstLine(b.rationale)}`)
        lines.push(`    adversary on ${labelOf(w)}: ${firstLine(w.rationale)}`)
        lines.push(`    grader on ${labelOf(b)}: ${graderLine(b.result)}`)
        lines.push(`    grader on ${labelOf(w)}: ${graderLine(w.result)}`)
      }
    } else {
      const reads = answers.map((a) => ({ a, sh: shapeOf(a) }))
      const agreed = reads.filter((r) => r.sh.agreed).length
      lines.push(
        `${head}  shape agreement ${agreed}/${reads.length}  quotes ${unresolved}/${quotes} unresolved  unjudged ${unjudged}/${judgedOf}`,
      )
      lines.push(
        `  ${reads
          .map((r) => (r.sh.agreed ? `${r.sh.expected} ok` : `${r.sh.expected} -> ${r.sh.observed}`))
          .join(' · ')}`,
      )
      if (verbose) {
        for (const r of reads) {
          if (r.sh.agreed) continue
          lines.push(`    adversary on ${r.sh.expected}: ${firstLine(r.a.rationale)}`)
          lines.push(`    grader on ${r.sh.expected}: ${graderLine(r.a.result)}`)
        }
      }
    }
  }

  lines.push('--- totals ---')
  if (s.levelsCards > 0) {
    const gradedLevels = rows.filter((r) => isLevelsKind(r.kind) && !r.mixed && scored(r) !== null).length
    lines.push(
      `rank agreement ${s.rankAgreed}/${s.rankTotal} (${pct(s.rankAgreed, s.rankTotal)}); ` +
        `${s.perfectCards}/${gradedLevels} card(s) perfect; ` +
        `mean adjacent gap ${s.meanAdjacentGap === null ? 'n/a' : f2(s.meanAdjacentGap)}; ` +
        `adjacent inversions ${s.adjacentInversions}`,
    )
    if (s.bandTotal > 0) lines.push(`band hit rate ${s.bandHits}/${s.bandTotal} (${pct(s.bandHits, s.bandTotal)}) — answers whose score landed in the adversary's intended band`)
  }
  if (s.modesCards > 0) {
    lines.push(`shape agreement ${s.shapeAgreed}/${s.shapeTotal} (${pct(s.shapeAgreed, s.shapeTotal)})`)
    lines.push('shape matrix (expected -> observed):')
    const observedCols: ObservedShape[] = [...GRADER_PANEL_MODES, 'none']
    lines.push(`  ${'expected'.padEnd(14)}${observedCols.map((c) => c.padStart(14)).join('')}`)
    for (const expected of Object.keys(s.shapeMatrix)) {
      const rowOf = s.shapeMatrix[expected]
      lines.push(`  ${expected.padEnd(14)}${observedCols.map((c) => String(rowOf[c] ?? 0).padStart(14)).join('')}`)
    }
  }
  lines.push(`unresolved quotes ${s.quotes.unresolved}/${s.quotes.quotes} (${pct(s.quotes.unresolved, s.quotes.quotes)})`)
  lines.push(`unjudged key points ${s.unjudged.unjudged}/${s.unjudged.judgedOf} (${pct(s.unjudged.unjudged, s.unjudged.judgedOf)}) — counted at 0 credit`)
  lines.push(`ungraded answers: ${s.ungraded}`)
  if (s.mixedCards > 0) lines.push(`mixed cards: ${s.mixedCards} (results split across models; excluded above)`)
  return lines.join('\n')
}
