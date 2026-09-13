/**
 * C3 — pairwise independence, with R5's free shortlist.
 *
 * ## The defect this looks for, and why nothing else can see it
 *
 * Two key points can each be true, each trace back to the card, and each
 * discriminate a strong answer from a weak one — and still be **one piece of
 * evidence counted twice**. Every BKT posterior downstream then moves twice for
 * one demonstration, so the learner reads as knowing the card better than they
 * do. Fidelity cannot see it (both points are true) and discrimination cannot
 * see it (both separate), which is why hygiene needs its own axis at all.
 *
 * ## Measured: this is the largest open hygiene defect
 *
 * Across all 130 authoring runs, using verdict matrices already stored and
 * costing nothing: **24.5% of key-point pairs have identical verdict vectors,
 * and 92% of cards have at least one.** Worst single card: 21 co-firing pairs
 * among 8 points. No check for it existed before this module.
 *
 * ## The shortlist is a CANDIDATE LIST, never a finding
 *
 * That 24.5% is not a redundancy rate and must never be reported as one. The
 * authoring run grades only three or four candidates, so a verdict vector is
 * three or four values wide and collisions happen by chance — two genuinely
 * independent points can easily agree on every adversary the run happened to
 * write. What the vector actually says is "these two never came apart in the
 * evidence we have", which is a reason to look, not a verdict.
 *
 * So the flow is R5's: shortlist for free, then spend one call per shortlisted
 * pair. Quadratic becomes roughly linear — 42 calls for a 7-point set drops to
 * however many pairs actually co-fired — and the subtle cases the shortlist
 * misses are the ones live co-occurrence catches later, once there are real
 * answers.
 *
 * ## Nothing here merges anything
 *
 * The design's routing table says redundancy auto-merges. This module reports
 * and stops. Two reasons: merging supersedes a `CardKlp`, which detaches
 * learner evidence (the re-grade job makes that survivable, not free); and
 * deciding which of two propositions survives a merge is a semantic judgment
 * about what the card teaches, not a mechanical one. With a candidate on 92% of
 * cards, an auto-merge would rewrite most of the corpus on the strength of a
 * three-column verdict vector.
 */
import { VERDICT_CREDIT, type KlpVerdict } from '@/lib/klp/verdicts'

/** One candidate's verdicts for a card, keyed by KLP index as stored. */
export type VerdictRow = Record<string, KlpVerdict>

export interface KlpPair {
  a: number
  b: number
}

/**
 * The free half: pairs whose credit vectors are identical across every graded
 * candidate.
 *
 * Compared on CREDIT rather than the raw label. `omission` and `failed` are
 * different diagnoses of the same outcome — the point was not earned — and two
 * points that both went unearned on every candidate are co-firing regardless of
 * which word the grader reached for. Comparing labels would miss them and
 * report a cleaner corpus than exists.
 *
 * A pair needs at least `minCandidates` observations to be shortlisted at all.
 * With one candidate every pair that scored the same is "identical", which is
 * no evidence whatsoever.
 */
export function coFiringPairs(
  rows: VerdictRow[],
  klpCount: number,
  minCandidates = 2,
): KlpPair[] {
  if (rows.length < minCandidates || klpCount < 2) return []

  const vector = (i: number) =>
    rows
      .map((r) => {
        const v = r[String(i)]
        // A MISSING verdict is its own value, not a zero. Treating an ungraded
        // point as failed would make two points look identical because the
        // grader skipped both.
        return v === undefined ? 'x' : String(VERDICT_CREDIT[v])
      })
      .join(',')

  const out: KlpPair[] = []
  for (let a = 0; a < klpCount; a++) {
    for (let b = a + 1; b < klpCount; b++) {
      if (vector(a) === vector(b)) out.push({ a, b })
    }
  }
  return out
}

/**
 * What the confirming call comes back with: can an answer hold one point
 * without the other, in each direction?
 */
export interface DirectionalAnswer {
  /** An answer can state A while NOT satisfying B. */
  aWithoutB: boolean
  /** An answer can state B while NOT satisfying A. */
  bWithoutA: boolean
}

export const PAIR_VERDICTS = ['independent', 'entails_b', 'entails_a', 'equivalent'] as const

export type PairVerdict = (typeof PAIR_VERDICTS)[number]

/**
 * Classifies a pair from the two directions. Pure — the model answers two
 * yes/no questions and every conclusion is drawn here.
 *
 * - both directions possible → **independent**. The shortlist was a
 *   coincidence, which is the expected outcome for most shortlisted pairs.
 * - A can stand alone but B cannot → **A entails B**: B adds nothing once A is
 *   stated, so B is the redundant one.
 * - neither direction → **equivalent**. The strongest claim, and the rarest.
 */
export function classifyPair(d: DirectionalAnswer): PairVerdict {
  if (d.aWithoutB && d.bWithoutA) return 'independent'
  if (d.aWithoutB && !d.bWithoutA) return 'entails_b'
  if (!d.aWithoutB && d.bWithoutA) return 'entails_a'
  return 'equivalent'
}

/**
 * ENTAILMENT IS NOT REDUNDANCY, and conflating them was a real bug here —
 * caught by reading the first confirmed result rather than by any test.
 *
 * The pair that found it:
 *   A. "the $100 cash deposit increases the cash asset and equity by the same amount"
 *   B. "because the cash rise is offset by the reduction in Net Debt, Enterprise
 *       Value is unchanged"
 *
 * A can be stated alone; B cannot, because B presupposes the cash and equity
 * rise. So **B implies A**. The first version of this function reported B as
 * "the redundant one" — backwards on two counts. B is not implied by anything,
 * and B carries information A does not (the EV neutralisation), so deleting
 * either point loses something real.
 *
 * What an entailment actually breaks is **conditional independence**: anyone
 * who demonstrates B has necessarily demonstrated A, so crediting both records
 * two observations for one demonstration and every posterior downstream moves
 * twice. That is the defect worth reporting — and its fix is in the scoring, not
 * in deleting a proposition.
 *
 * Only `equivalent` is a genuine merge candidate, and even then this refuses to
 * pick the survivor: which of two interchangeable propositions a card should
 * keep is a judgment about what it teaches.
 */
export interface PairRelationship {
  /** True only for `equivalent` — the pair says one thing twice. */
  mergeCandidate: boolean
  /**
   * Set on an entailment: satisfying `implier` necessarily satisfies `implied`,
   * so the two are not independent evidence.
   */
  implier: number | null
  implied: number | null
}

export function pairRelationship(pair: KlpPair, verdict: PairVerdict): PairRelationship {
  // aWithoutB && !bWithoutA  =>  B cannot stand alone  =>  B implies A.
  if (verdict === 'entails_b') return { mergeCandidate: false, implier: pair.b, implied: pair.a }
  if (verdict === 'entails_a') return { mergeCandidate: false, implier: pair.a, implied: pair.b }
  if (verdict === 'equivalent') return { mergeCandidate: true, implier: null, implied: null }
  return { mergeCandidate: false, implier: null, implied: null }
}

export interface PairResult {
  cardId: string
  term: string
  pair: KlpPair
  textA: string
  textB: string
  verdict: PairVerdict
  /** The model's example answers, kept as evidence for a human reading this. */
  exampleAWithoutB: string
  exampleBWithoutA: string
}

export interface IndependenceSummary {
  cards: number
  klpPairsTotal: number
  shortlisted: number
  confirmed: number
  byVerdict: Record<PairVerdict, number>
  /** Cards carrying at least one non-independent pair. */
  cardsWithRedundancy: number
  /**
   * Pairs that are one proposition twice. The only merge candidates, and the
   * only place "redundant" is the right word.
   */
  mergeCandidates: number
  /**
   * Pairs where one point implies the other. NOT merge candidates — both carry
   * information — but they are not independent evidence either, so crediting
   * both double-counts one demonstration in every posterior downstream.
   */
  dependencies: number
}

export function summarizeIndependence(
  results: PairResult[],
  cards: number,
  klpPairsTotal: number,
  shortlisted: number,
): IndependenceSummary {
  const byVerdict = Object.fromEntries(PAIR_VERDICTS.map((v) => [v, 0])) as Record<
    PairVerdict,
    number
  >
  const cardsWith = new Set<string>()
  let mergeCandidates = 0
  let dependencies = 0

  for (const r of results) {
    byVerdict[r.verdict] += 1
    if (r.verdict === 'independent') continue
    cardsWith.add(r.cardId)
    const rel = pairRelationship(r.pair, r.verdict)
    if (rel.mergeCandidate) mergeCandidates += 1
    else dependencies += 1
  }

  return {
    cards,
    klpPairsTotal,
    shortlisted,
    confirmed: results.length,
    byVerdict,
    cardsWithRedundancy: cardsWith.size,
    mergeCandidates,
    dependencies,
  }
}

/**
 * The rate that actually means something: of the pairs the shortlist proposed
 * and a call examined, how many were genuinely not independent?
 *
 * Null when nothing was confirmed. Deliberately NOT computed over the whole
 * pair space — the shortlist is not a random sample of pairs, so projecting
 * this rate onto every pair on the card would be wrong in an unknown direction.
 */
export function confirmedRedundancyRate(s: IndependenceSummary): number | null {
  if (s.confirmed === 0) return null
  return (s.confirmed - s.byVerdict.independent) / s.confirmed
}

export function formatIndependenceReport(s: IndependenceSummary): string {
  const rate = confirmedRedundancyRate(s)
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  const lines: string[] = []

  lines.push(`Independence (C3) — ${s.cards} card(s)`)
  lines.push('')
  lines.push(
    `  Shortlist (FREE, no AI call): ${s.shortlisted} of ${s.klpPairsTotal} pairs co-fired ` +
      `(${s.klpPairsTotal === 0 ? 'n/a' : pct(s.shortlisted / s.klpPairsTotal)})`,
  )
  lines.push(
    `  THAT IS A CANDIDATE RATE, NOT A REDUNDANCY RATE. A verdict vector is only as wide as the`,
  )
  lines.push(
    `  candidates the authoring run graded, so two independent points can agree on all of them`,
  )
  lines.push(`  by chance. Only the confirming call decides.`)
  lines.push('')
  lines.push(`  Confirmed by a call: ${s.confirmed}`)
  for (const v of PAIR_VERDICTS) {
    lines.push(`    ${v.padEnd(12)} ${String(s.byVerdict[v]).padStart(4)}`)
  }
  lines.push('')
  lines.push(
    `  Of pairs actually examined, ${rate === null ? 'n/a' : pct(rate)} were NOT independent, ` +
      `across ${s.cardsWithRedundancy} card(s):`,
  )
  lines.push(
    `    ${s.mergeCandidates} merge candidate(s) — the pair says one thing twice`,
  )
  lines.push(
    `    ${s.dependencies} dependenc(ies) — one point implies the other. NOT a merge: both carry`,
  )
  lines.push(
    `      information. But they are not independent EVIDENCE, so crediting both records two`,
  )
  lines.push(
    `      observations for one demonstration and every posterior downstream moves twice.`,
  )
  lines.push('')
  lines.push('  NOTHING WAS MERGED. Which of two interchangeable propositions a card should keep is')
  lines.push('  a judgment about what it teaches, and merging supersedes a key point, which detaches')
  lines.push('  learner evidence until the re-grade job catches up.')

  return lines.join('\n')
}

/**
 * Reads the probe's reply into the two booleans the classifier needs.
 *
 * A DIRECTION IS ONLY POSSIBLE IF AN EXAMPLE WAS ACTUALLY WRITTEN. The prompt
 * asks for a construction precisely so the claim is checkable, and a model that
 * says "yes, an answer could do that" and then writes nothing has demonstrated
 * nothing. Trusting the boolean alone would let the check degrade into the
 * opinion it was designed to avoid — and it degrades in the flattering
 * direction, since `independent` is the outcome that reports no defect.
 */
export function readProbe(reply: {
  aWithoutB: boolean
  exampleAWithoutB: string
  bWithoutA: boolean
  exampleBWithoutA: string
}): DirectionalAnswer {
  return {
    aWithoutB: reply.aWithoutB && reply.exampleAWithoutB.trim().length > 0,
    bWithoutA: reply.bWithoutA && reply.exampleBWithoutA.trim().length > 0,
  }
}
