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
 *   causalEdges      causal / "because" points are relations, typed causes|precedes
 *   causalTargets    those relations name the point that supplies their cause (causeKlpRef)
 *   brevity          leaf names within MAX_NAME_WORDS
 *   vocabulary       leaf names take their words from their own point's text
 *   noContainers     no leaf is a statement or bucket name
 *
 * v1 proposals (no anchor, no `under`, no `affectsKlpRef`) score 0 on
 * `anchored` and `causalTargets` by construction — that is the gap v2 exists
 * to close, and it is reported rather than hidden.
 */
import { klpFidelity, isContainerName, normalizeName } from '@/lib/klp/topic-reconcile'
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
  /** Unweighted mean of the seven. */
  overall: number
  detail: {
    uncovered: number[]
    unanchored: string[]
    causalAsLeaf: number[]
    longNames: string[]
    containers: string[]
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
  const causalWithEdge = causalRefs.filter((i) => p.relations.some((r) => r.klpRef === i && (r.type === 'causes' || r.type === 'precedes' || r.type === 'applies_within')))
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

  const r = {
    coverage: share(n - uncovered.length, n),
    anchored: share(p.leaves.length - unanchored.length, p.leaves.length),
    causalEdges: share(causalWithEdge.length, causalRefs.length),
    causalTargets: share(causalTargets.length, causalWithEdge.length),
    brevity: share(p.leaves.length - longNames.length, p.leaves.length),
    vocabulary,
    noContainers: share(p.leaves.length - containers.length, p.leaves.length),
  }
  const overall = (r.coverage + r.anchored + r.causalEdges + r.causalTargets + r.brevity + r.vocabulary + r.noContainers) / 7
  return { ...r, overall, detail: { uncovered, unanchored, causalAsLeaf, longNames, containers } }
}

export function settingsFromV2(klps: { text: string; kind: string }[], p: CardTopicProposalV2): KltSettingsReport {
  return kltSettings({ klps, proposal: p })
}
