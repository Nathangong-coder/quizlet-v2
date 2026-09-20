import type { PriorFinding } from './authoring'
import { BEYOND_CARD_CAP } from './authoring-config'

/**
 * CARD-GAP ROUTING (2026-09-20, owner's ask: a gap "should primarily affect
 * KLPs and then secondarily affect the grading/card").
 *
 * A card gap is what the benchmark's reconciliation says a strong answer
 * needs and NO key point covers (`review-panel-grade` v4). Before this
 * module the gaps were printed for the owner and went nowhere else. Now the
 * best-supported gaps per card go into the same `--findings` file the
 * definition probe and the point defects use, as `card_gap` findings the
 * author prompt (v9) writes as BEYOND THE CARD points; the rest stay on the
 * owner's queue.
 *
 * Two rules, both in TypeScript:
 *  - A gap must carry its REASONING. "Debt is cheaper than equity" is a bare
 *    generalisation; "debt is generally cheaper than equity because interest
 *    is tax-deductible" is a point. The schema asks for `{ claim, reasoning }`
 *    and `formatCardGap` joins them; a bare string from the model is dropped
 *    in `foldReview`, never routed.
 *  - At most `GAP_ROUTE_CAP` gaps per card are routed, ranked by SUPPORT —
 *    how many of the panel's answers raised the same gap. The cap matches
 *    author-klps's "at most two points beyond the card": the writer cannot
 *    author more than that anyway, and the owner's queue keeps the rest.
 */
export const GAP_ROUTE_CAP = BEYOND_CARD_CAP

export interface CardGapDraft {
  claim: string
  reasoning: string
}

/** The stored form of a gap: one line, claim then reasoning, so every reader that splits on lines still works. */
export function formatCardGap(gap: CardGapDraft): string {
  const claim = gap.claim.trim().replace(/[.\s]+$/, '')
  const reasoning = gap.reasoning.trim().replace(/^(because|since|as)\s+/i, '').replace(/[.\s]+$/, '')
  return `${claim} — because ${reasoning}`
}

/**
 * De-duplication key: the first six words of the claim, lower-cased, hyphens
 * and slashes read as word breaks ("tax-deductible" and "tax deductible" are
 * one gap), other punctuation stripped. probe-state and the review page use
 * this same function.
 */
export function gapKey(gap: string): string {
  return gap.toLowerCase().replace(/[-\/]/g, ' ').replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 6).join(' ')
}

/** The stored form's separator; `parseCardGaps` reads it back off a review summary. */
export const CARD_GAPS_MARKER = 'CARD GAPS:'

/** Read the gaps back off a `GraderPanelReview.summary` — the inverse of the suffix benchmark-run writes. */
export function parseCardGaps(summary: string): string[] {
  const at = summary.indexOf(CARD_GAPS_MARKER)
  if (at < 0) return []
  return summary
    .slice(at + CARD_GAPS_MARKER.length)
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean)
}

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'is', 'are', 'be', 'so', 'as', 'at', 'it', 'its', 'that', 'this', 'than', 'from', 'into', 'over', 'not', 'no', 'which', 'who', 'when', 'if', 'then', 'their', 'they', 'them', 'his', 'her', 'can', 'will', 'may', 'must', 'should', 'would', 'generally', 'typically', 'usually', 'often', 'because', 'since', 'through', 'via', 'rather', 'only'])

/** Content words of the CLAIM (before " — because"), crudely stemmed, for the near-duplicate test. */
export function gapContentWords(gap: string): Set<string> {
  const claim = gap.split(' — because')[0]
  const out = new Set<string>()
  for (const raw of claim.toLowerCase().replace(/[-\/]/g, ' ').replace(/[^a-z0-9 ]/g, '').split(' ')) {
    if (!raw || STOPWORDS.has(raw)) continue
    // Crude and consistent: -ing, -ed, then a plural -s. Never -es ("comes" and "come" must stem alike).
    const w = raw.replace(/(ing|ed)$/, '').replace(/s$/, '')
    if (w.length >= 2) out.add(w)
  }
  return out
}

/**
 * Two gaps are ONE gap when the content words of their claims overlap by at
 * least this Jaccard share. Measured on the first routed run (2026-09-20):
 * "targets are chosen for stable, predictable cash flows and low capex" vs
 * "targets need stable, predictable cash flows and low capex so FCF is
 * available" read 0.56; the three "returns come from debt paydown, EBITDA
 * growth and multiple expansion" wordings read 0.40-0.55 against each other;
 * "capable management team" vs "strong management" read 0.10 — different
 * gaps, correctly. Below the first-six-words rule those pairs each took two
 * routing slots for one claim.
 */
export const GAP_MERGE_JACCARD = 0.4

export function sameGap(a: string, b: string): boolean {
  if (gapKey(a) === gapKey(b)) return true
  const wa = gapContentWords(a)
  const wb = gapContentWords(b)
  if (wa.size === 0 || wb.size === 0) return false
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  const union = wa.size + wb.size - inter
  return union > 0 && inter / union >= GAP_MERGE_JACCARD
}

/**
 * Does a key point COVER a routed gap? Overlap coefficient (shared content
 * words over the smaller set) rather than Jaccard, because a point is
 * shorter than the gap it was authored from. Measured on the first routed
 * run: "When free cash flow is negative in a year, the shortfall is funded by
 * drawing the revolver…" against its gap reads 0.73; "TLA is swept before
 * TLB" against the tranche gap reads 0.5; an unrelated step reads under 0.3.
 */
export const GAP_COVER_OVERLAP = 0.5

export function pointCoversGap(pointText: string, gap: string): boolean {
  const wp = gapContentWords(pointText)
  const wg = gapContentWords(gap)
  if (wp.size === 0 || wg.size === 0) return false
  let inter = 0
  for (const w of wp) if (wg.has(w)) inter++
  return inter / Math.min(wp.size, wg.size) >= GAP_COVER_OVERLAP
}

export interface RoutedGap {
  gap: string
  /** How many reviewed answers raised this gap on this card. */
  support: number
}

export interface GapRouting {
  /** Per card, the gaps that go to the authoring loop, best-supported first. */
  routed: Record<string, RoutedGap[]>
  /** Everything else, de-duplicated, for the owner's queue. */
  ownerOnly: { cardId: string; gap: string; support: number }[]
}

/**
 * Group by card, merge near-duplicates (`sameGap`, the first wording kept),
 * count support, rank by support then first appearance, and split at the
 * cap. Pure.
 */
export function routeCardGaps(gaps: readonly { cardId: string; gap: string }[], cap: number = GAP_ROUTE_CAP): GapRouting {
  const byCard = new Map<string, (RoutedGap & { order: number })[]>()
  let order = 0
  for (const g of gaps) {
    const text = g.gap.trim()
    if (!text) continue
    const perCard = byCard.get(g.cardId) ?? []
    byCard.set(g.cardId, perCard)
    const existing = perCard.find((c) => sameGap(c.gap, text))
    if (existing) existing.support++
    else perCard.push({ gap: text, support: 1, order: order++ })
  }
  const routed: Record<string, RoutedGap[]> = {}
  const ownerOnly: GapRouting['ownerOnly'] = []
  for (const [cardId, perCard] of byCard) {
    const ranked = [...perCard].sort((a, b) => b.support - a.support || a.order - b.order)
    const take = Math.max(0, cap)
    routed[cardId] = ranked.slice(0, take).map(({ gap, support }) => ({ gap, support }))
    for (const r of ranked.slice(take)) ownerOnly.push({ cardId, gap: r.gap, support: r.support })
  }
  return { routed, ownerOnly }
}

/** The routed gaps as `--findings` entries for `author-klps`. */
export function gapFindings(routed: readonly RoutedGap[]): PriorFinding[] {
  return routed.map((r) => ({
    index: null,
    text: r.gap,
    issue: 'card_gap',
    fix: `Author this as a BEYOND THE CARD point (fromDefinition null, named in concerns), keeping its reasoning — raised by ${r.support} of the panel's answers.`,
  }))
}
