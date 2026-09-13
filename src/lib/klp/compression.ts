/**
 * COMPRESSION AS A REVISE INPUT (2026-09-13, owner's plan, steps A–C).
 *
 * The revise loop had only upward pressure on length: separation says
 * sharpen, parity says add, the count target permits a context clause per
 * point. Every rebuilt answer came out 25-40% longer than its reference and
 * the reviewer's `wordy` label on it was recorded and read by nothing.
 *
 * This module turns three signals into findings the existing revise prompt
 * renders under the points:
 *
 *  - the REVIEWER's read of the rebuilt answer, attached to point indices
 *    (`compressionFindings`): restatement and clause bloat. Transitions are
 *    the rebuilder's doing, not the points', and are recorded but never a
 *    finding. NOT-ON-CARD is recorded but never a finding either, since the
 *    spread x2 (2026-09-13): it cut "CapEx below depreciation at a mature firm
 *    may signal underinvestment" from a card whose owner wrote one line, and
 *    parity fell to 0.50 with nothing left to revise. The author prompt says
 *    to add what a strong answer needs that the card omits, and the owner
 *    does not enrich terse cards — so a point being absent from the card is
 *    expected, not a defect. The parity grader is the authority on whether a
 *    claim belongs; a cut it would object to must not be made a round before
 *    it can object.
 *  - a per-point VERBOSE bound (`verboseDefect`): over VERBOSE_POINT_WORDS
 *    words, or two subordinate clauses. A hygiene bound in the family of
 *    `compound`, computed for free; the reviewer does the judgement.
 *  - the WORD RATIO of the rebuilt answer to the reference (`wordRatio`,
 *    `ratioFinding`): the number that says whether it worked.
 *
 * Precedence, stated in the revise prompt: cut words, never distinct
 * claims. A compression finding may merge or shorten; every claim a parity
 * or coverage finding names must survive.
 */

export const VERBOSE_POINT_WORDS = 30
export const VERBOSE_CLAUSE_MARKERS = 2
export const REBUILD_WORD_RATIO_BAR = 1.2

export const REBUILT_ISSUE_KINDS = ['restatement', 'clause_bloat', 'not_on_card', 'transition'] as const
export type RebuiltIssueKind = (typeof REBUILT_ISSUE_KINDS)[number]

export interface RebuiltReview {
  conciseness: 'tight' | 'wordy' | 'bloated'
  clarity: 'clear' | 'muddled'
  issues: { kind: RebuiltIssueKind; points: number[]; text: string }[]
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Subordinate-clause markers a point should carry at most once. */
const CLAUSE_MARKERS = /\b(because|which is why|which means|so that|whereas|while|since|as a result|meaning that|such that)\b|, so\b|, which\b/gi

export function clauseMarkerCount(text: string): number {
  return (text.match(CLAUSE_MARKERS) ?? []).length
}

/** The deterministic bound; null when the point is within it. */
export function verboseDefect(text: string): string | null {
  const words = wordCount(text)
  const clauses = clauseMarkerCount(text)
  if (words > VERBOSE_POINT_WORDS) return `${words} words; a point states one claim in at most ${VERBOSE_POINT_WORDS}`
  if (clauses >= VERBOSE_CLAUSE_MARKERS) return `${clauses} subordinate clauses; keep the claim and at most one "because"`
  return null
}

export function wordRatio(rebuilt: string, reference: string): number | null {
  const r = wordCount(reference)
  if (r === 0) return null
  return wordCount(rebuilt) / r
}

export interface CompressionFinding {
  index: number | null
  issue: string
  fix: string
}

/**
 * The reviewer's issues as per-point findings. An issue with no valid
 * point index is dropped — a finding the revise prompt cannot place is
 * noise, and the reviewer was asked for indices.
 */
export function compressionFindings(review: RebuiltReview | undefined, klpCount: number): CompressionFinding[] {
  if (!review) return []
  const out: CompressionFinding[] = []
  for (const issue of review.issues) {
    if (issue.kind === 'transition' || issue.kind === 'not_on_card') continue
    const points = [...new Set(issue.points.filter((i) => Number.isInteger(i) && i >= 0 && i < klpCount))]
    if (points.length === 0) continue
    const others = (i: number) => points.filter((p) => p !== i).map((p) => `[${p}]`).join(', ')
    for (const i of points) {
      if (issue.kind === 'restatement') {
        out.push({
          index: i,
          issue: `restatement${others(i) ? ` with ${others(i)}` : ''}: ${issue.text}`,
          fix: 'these points make the same claim in different words; keep ONE of them (the one a wrong answer is likeliest to fail) and cut the rest',
        })
      } else {
        out.push({
          index: i,
          issue: `clause bloat: ${issue.text}`,
          fix: 'cut to the bare claim; move the because-clause to its own point ONLY if a wrong answer could fail it on its own, otherwise drop it',
        })
      }
    }
  }
  return out
}

/** Set-level finding when the points rebuild materially longer than the reference. */
export function ratioFinding(ratio: number | null): CompressionFinding | null {
  if (ratio === null || ratio <= REBUILD_WORD_RATIO_BAR) return null
  return {
    index: null,
    issue: `the key points rebuild to ${ratio.toFixed(2)}x the reference's length (bar ${REBUILD_WORD_RATIO_BAR})`,
    fix: 'the points carry more words than the claims need; merge restated points and cut context clauses — keep every distinct claim',
  }
}
