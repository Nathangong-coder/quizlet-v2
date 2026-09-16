/**
 * KLT SETTINGS — the measurable side of anchored minting (2026-09-15).
 *
 * The owner asked for "flexible rules, like the KLP settings", used to
 * (1) measure how well a minted proposal follows the shape we want and
 * (2) improve the prompt against those numbers. Each setting is a share in
 * 0-1 computed in TypeScript from the proposal and the KLPs; none is a gate.
 * Reported per card and averaged over a run, beside `klpKltEnforcement`.
 *
 *   coverage         every point carries a leaf or a relation
 *   anchored         every leaf branches from the anchor (directly or via `under`)
 *   causalEdges      causal / "because" points are relations of a directed type (never confused_with)
 *   causalTargets    those relations name the point that supplies their cause (causeKlpRef)
 *   brevity          leaf names within MAX_NAME_WORDS
 *   vocabulary       leaf names take their words from their own point's text
 *   noContainers     no leaf is a statement or bucket name
 *   distinctness     no two leaves on the card are near-duplicates by name
 *                    (containment or two-thirds token overlap) — the
 *                    deterministic proxy for "a learner can fail one and not
 *                    the other"; a judge on the near pairs is the next step
 *   roundTrip        (needs a model call, merged in by the caller) the share
 *                    of covered points a grader files back under the label
 *                    that minted them, shown only the labels and the points
 *
 * v1 proposals (no anchor, no `under`, no `affectsKlpRef`) score 0 on
 * `anchored` and `causalTargets` by construction — that is the gap v2 exists
 * to close, and it is reported rather than hidden.
 */
import { klpFidelity, isContainerName, normalizeName, sameConceptByRule } from '@/lib/klp/topic-reconcile'
import { tokenJaccard, TOKEN_MATCH } from '@/lib/klt/match'
import { MAX_NAME_WORDS, type CardTopicProposalV2 } from '@/lib/klp/topic-minting-v2'

export interface SettingsInput {
  klps: { text: string; kind: string }[]
  proposal: {
    anchor?: string
    leaves: { name: string; klpRefs: number[]; under?: string }[]
    contexts: { klpRef: number; concept: string }[]
    relations: { klpRef: number; from: string; to: string; type: string; causeKlpRef?: number }[]
  }
}

export interface KltSettingsReport {
  coverage: number
  anchored: number
  causalEdges: number
  causalTargets: number
  brevity: number
  vocabulary: number
  noContainers: number
  distinctness: number
  /** Set by `withRoundTrip`; undefined until the assignment call has run. */
  roundTrip?: number
  /** Unweighted mean of the deterministic eight, plus roundTrip when present. */
  overall: number
  detail: {
    uncovered: number[]
    unanchored: string[]
    causalAsLeaf: number[]
    longNames: string[]
    containers: string[]
    /** Pairs of leaf names the proxy calls near-duplicates. */
    indistinct: [string, string][]
    /** Points a grader filed elsewhere: [klpRef, minted label, assigned label or null]. */
    wandered?: [number, string, string | null][]
  }
}

const BECAUSE = /\b(because|so that|which means|which is why|as a result|therefore|hence|leads to|results in)\b/i

export function isCausalPoint(k: { text: string; kind: string }): boolean {
  return k.kind === 'causal' || BECAUSE.test(k.text)
}

const share = (num: number, den: number) => (den === 0 ? 1 : num / den)

export function kltSettings(input: SettingsInput): KltSettingsReport {
  const { klps, proposal: p } = input
  const n = klps.length
  // coverage
  const covered = new Set<number>([...p.leaves.flatMap((l) => l.klpRefs), ...p.relations.map((r) => r.klpRef)])
  const uncovered = klps.map((_, i) => i).filter((i) => !covered.has(i))
  // anchored: follow `under` chains to the anchor
  const anchorNorm = p.anchor ? normalizeName(p.anchor) : null
  const byName = new Map(p.leaves.map((l) => [normalizeName(l.name), l]))
  const reachesAnchor = (l: { name: string; under?: string }, seen = new Set<string>()): boolean => {
    if (!anchorNorm || !l.under) return false
    const u = normalizeName(l.under)
    if (u === anchorNorm || normalizeName(l.name) === anchorNorm) return true
    if (seen.has(u)) return false
    seen.add(u)
    const parent = byName.get(u)
    return parent ? reachesAnchor(parent, seen) : false
  }
  const unanchored = p.leaves.filter((l) => !reachesAnchor(l)).map((l) => l.name)
  // causal
  const causalRefs = klps.map((k, i) => (isCausalPoint(k) ? i : -1)).filter((i) => i >= 0)
  // Any DIRECTED type is a causal edge — `requires` ("B cannot be stated
  // without A") is how the minter renders a fifth of causal points, and it
  // is right to; only `confused_with` is not a cause (measured on M&A,
  // 2026-09-15: 20 of 130 causal points as requires, 9 as confused_with).
  const causalWithEdge = causalRefs.filter((i) => p.relations.some((r) => r.klpRef === i && r.type !== 'confused_with'))
  const causalAsLeaf = causalRefs.filter((i) => !p.relations.some((r) => r.klpRef === i))
  const causalTargets = causalWithEdge.filter((i) => p.relations.some((r) => r.klpRef === i && typeof r.causeKlpRef === 'number' && r.causeKlpRef !== i))
  // names
  const words = (s: string) => normalizeName(s).split(' ').filter(Boolean).length
  const longNames = p.leaves.map((l) => l.name).filter((nm) => words(nm) > MAX_NAME_WORDS)
  const containers = p.leaves.map((l) => l.name).filter((nm) => isContainerName(nm))
  // vocabulary: mean fidelity of each leaf against the text of its points
  const fid = p.leaves.map((l) => {
    const texts = l.klpRefs.map((i) => klps[i]?.text ?? '').join(' ')
    return klpFidelity(l.name, texts)
  })
  const vocabulary = fid.length ? fid.reduce((a, b) => a + b, 0) / fid.length : 1
  // distinctness: every pair of leaf names, by the matcher's own identity rules
  // A sub-leaf is ALLOWED to contain its parent's name ("fair value
  // write-down" under "historical deferred revenue treatment" is the point of
  // the split), so pairs joined by `under` — and pairs with the anchor — are
  // structure, not duplication.
  const names = p.leaves.map((l) => l.name)
  const under = (l: { name: string; under?: string }) => (l.under ? normalizeName(l.under) : null)
  const indistinct: [string, string][] = []
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = normalizeName(names[i]), b = normalizeName(names[j])
      if (a === b) continue // the same leaf listed twice is a duplicate, caught elsewhere
      if (anchorNorm && (a === anchorNorm || b === anchorNorm)) continue
      if (under(p.leaves[i]) === b || under(p.leaves[j]) === a) continue
      if (sameConceptByRule(a, b) || tokenJaccard(a, b) >= TOKEN_MATCH) indistinct.push([names[i], names[j]])
    }
  const involved = new Set(indistinct.flat())

  const r = {
    coverage: share(n - uncovered.length, n),
    anchored: share(p.leaves.length - unanchored.length, p.leaves.length),
    causalEdges: share(causalWithEdge.length, causalRefs.length),
    causalTargets: share(causalTargets.length, causalWithEdge.length),
    brevity: share(p.leaves.length - longNames.length, p.leaves.length),
    vocabulary,
    noContainers: share(p.leaves.length - containers.length, p.leaves.length),
    distinctness: share(p.leaves.length - involved.size, p.leaves.length),
  }
  const overall = (r.coverage + r.anchored + r.causalEdges + r.causalTargets + r.brevity + r.vocabulary + r.noContainers + r.distinctness) / 8
  return { ...r, overall, detail: { uncovered, unanchored, causalAsLeaf, longNames, containers, indistinct } }
}

/** The labels a round-trip grader is shown: leaf names and "from → to" for relations. */
export function roundTripLabels(p: SettingsInput['proposal']): { labels: string[]; mintedLabelOf: Map<number, string[]> } {
  // A point minted to a leaf AND a relation (or to two leaves) owns every one
  // of those labels; the grader choosing any of them is a hit.
  const mintedLabelOf = new Map<number, string[]>()
  const labels = new Set<string>()
  const add = (ref: number, lab: string) => { const arr = mintedLabelOf.get(ref) ?? []; if (!arr.includes(lab)) arr.push(lab); mintedLabelOf.set(ref, arr) }
  for (const l of p.leaves) { labels.add(l.name); for (const ref of l.klpRefs) add(ref, l.name) }
  for (const r of p.relations) { const lab = `${r.from} → ${r.to}`; labels.add(lab); add(r.klpRef, lab) }
  return { labels: [...labels], mintedLabelOf }
}

/** Fold a round-trip assignment into the report. `assigned` is klpRef -> label|null as the grader returned it. */
export function withRoundTrip(report: KltSettingsReport, p: SettingsInput['proposal'], assigned: { klpRef: number; label: string | null }[]): KltSettingsReport {
  const { mintedLabelOf } = roundTripLabels(p)
  const norm = (s: string | null) => (s == null ? null : s.toLowerCase().replace(/\s+/g, ' ').trim())
  let hit = 0
  const wandered: [number, string, string | null][] = []
  for (const [ref, minted] of mintedLabelOf) {
    const a = assigned.find((x) => x.klpRef === ref)
    const got = a ? a.label : null
    if (minted.some((m) => norm(m) === norm(got))) hit += 1
    else wandered.push([ref, minted[0], got])
  }
  const roundTrip = mintedLabelOf.size === 0 ? 1 : hit / mintedLabelOf.size
  const overall = (report.overall * 8 + roundTrip) / 9
  return { ...report, roundTrip, overall, detail: { ...report.detail, wandered } }
}

export function settingsFromV2(klps: { text: string; kind: string }[], p: CardTopicProposalV2): KltSettingsReport {
  return kltSettings({ klps, proposal: p })
}
