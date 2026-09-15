/**
 * KLP → KLT ENFORCEMENT (2026-09-15, owner).
 *
 * The minter is told what shape each point should take — a kind prior
 * (RULE 8) and, from this change, the card's OWN relation graph — and the
 * trace showed it minting leaves where edges were expected on 18% of points
 * ("Why is GAAP important?": the causal points came back as leaves). Two
 * things here:
 *
 *  1. THE STATISTIC. `enforcementReport` compares each point's minted shape
 *     with what the pipeline intended and returns the share that agree —
 *     `klpKltEnforcement`, which should sit near 1.0. The intention comes
 *     from two sources, the stronger first: a point that is the SOURCE of a
 *     directed link in the card's own `KlpRelation` graph must become an
 *     edge; otherwise the kind prior (causal / condition / contrast → edge;
 *     definition / quantitative / example → leaf; mechanism → either). A
 *     point whose intention is "either" never counts as a violation.
 *
 *  2. THE REPAIR. Rather than re-minting a whole card when the statistic
 *     falls short, `buildMintRepairPrompt` sends ONLY the violating points
 *     with the proposal as it stands and asks for the missing shape — an
 *     edge with standalone endpoints, or a leaf — which `applyRepair` folds
 *     back into the proposal. One small call instead of a full re-mint.
 *
 * Pure. The probe and the write step feed it.
 */
import { z } from 'zod'
import { EXPECTED_SHAPE, DEFAULT_EDGE_TYPE, type CardTopicProposal, type PromptKlp } from '@/lib/klp/topic-minting'
import { DIRECTED_TYPES, RELATABLE_TYPES } from '@/lib/klp/relations'

export interface KlpLink {
  /** Indices into the card's KLP list. */
  from: number
  to: number
  type: string
}

export type MintedShape = 'leaf' | 'edge' | 'both' | 'context-only' | 'unmapped'
export type IntendedShape = 'leaf' | 'edge' | 'either'

export interface EnforcementRow {
  ref: number
  kind: string
  intended: IntendedShape
  /** Why the intention is what it is. */
  basis: 'link-source' | 'kind'
  minted: MintedShape
  violation: boolean
}

export interface EnforcementReport {
  rows: EnforcementRow[]
  /** Points with a definite intention (not "either"). */
  judged: number
  violations: number
  /** 1 − violations / judged; 1 when nothing was judged. */
  klpKltEnforcement: number
}

export function mintedShape(proposal: CardTopicProposal, ref: number): MintedShape {
  const leaf = proposal.leaves.some((l) => l.klpRefs.includes(ref))
  const edge = proposal.relations.some((r) => r.klpRef === ref)
  const ctx = proposal.contexts.some((c) => c.klpRef === ref)
  if (leaf && edge) return 'both'
  if (leaf) return 'leaf'
  if (edge) return 'edge'
  if (ctx) return 'context-only'
  return 'unmapped'
}

export function intendedShape(kind: string, ref: number, links: KlpLink[]): { intended: IntendedShape; basis: 'link-source' | 'kind' } {
  const isSource = links.some((l) => l.from === ref && (DIRECTED_TYPES as readonly string[]).includes(l.type))
  if (isSource) return { intended: 'edge', basis: 'link-source' }
  const prior = (EXPECTED_SHAPE as Record<string, IntendedShape | undefined>)[kind] ?? 'either'
  return { intended: prior, basis: 'kind' }
}

export function enforcementReport(klps: { kind: string }[], links: KlpLink[], proposal: CardTopicProposal): EnforcementReport {
  const rows: EnforcementRow[] = klps.map((k, ref) => {
    const { intended, basis } = intendedShape(k.kind, ref, links)
    const minted = mintedShape(proposal, ref)
    const violation =
      intended === 'edge' ? !(minted === 'edge' || minted === 'both') : intended === 'leaf' ? !(minted === 'leaf' || minted === 'both') : false
    return { ref, kind: k.kind, intended, basis, minted, violation }
  })
  const judged = rows.filter((r) => r.intended !== 'either').length
  const violations = rows.filter((r) => r.violation).length
  return { rows, judged, violations, klpKltEnforcement: judged === 0 ? 1 : 1 - violations / judged }
}

/** The card's own graph, rendered for the minting prompt. */
export function renderLinks(links: KlpLink[]): string {
  if (links.length === 0) return ''
  const lines = links.map((l) => `  [${l.from}] —${l.type}→ [${l.to}]`).join('\n')
  return `KNOWN LINKS BETWEEN THESE POINTS — the card's own relation graph, extracted when the
points were written. A point that is the SOURCE of a causes / requires / precedes /
applies_within link is about a connection, and MUST be emitted as a relation between the
two points' concepts (from = what the source point is about, to = what the target point is
about), not as a leaf:
${lines}
`
}

// ---------------------------------------------------------------------------
// The repair call
// ---------------------------------------------------------------------------

export const MintRepairSchema = z.object({
  relations: z
    .array(
      z.object({
        klpRef: z.number().int(),
        from: z.string(),
        to: z.string(),
        type: z.enum(RELATABLE_TYPES),
      }),
    )
    .default([]),
  leaves: z.array(z.object({ klpRef: z.number().int(), name: z.string() })).default([]),
})
export type MintRepair = z.infer<typeof MintRepairSchema>

export function buildMintRepairPrompt(term: string, klps: PromptKlp[], links: KlpLink[], proposal: CardTopicProposal, report: EnforcementReport): string {
  const bad = report.rows.filter((r) => r.violation)
  const needEdge = bad.filter((r) => r.intended === 'edge')
  const needLeaf = bad.filter((r) => r.intended === 'leaf')
  const point = (ref: number) => klps.find((k) => k.ref === ref)
  const linkOf = (ref: number) => links.filter((l) => l.from === ref).map((l) => `[${l.from}] —${l.type}→ [${l.to}] (target point: "${point(l.to)?.text ?? ''}")`).join('; ')
  const edgeLines = needEdge
    .map((r) => {
      const k = point(r.ref)
      const current = proposal.leaves.filter((l) => l.klpRefs.includes(r.ref)).map((l) => l.name).join(', ')
      return `  [${r.ref}] (${r.kind}) ${k?.text ?? ''}\n      minted as leaf "${current}" — must be a relation${r.basis === 'link-source' ? `; known link: ${linkOf(r.ref)}` : `; default type ${(DEFAULT_EDGE_TYPE as Record<string, string | undefined>)[r.kind] ?? 'causes'}`}`
    })
    .join('\n')
  const leafLines = needLeaf.map((r) => `  [${r.ref}] (${r.kind}) ${point(r.ref)?.text ?? ''}\n      minted only as a relation — must also name the concept it defines as a leaf`).join('\n')
  const vocab = [...new Set([...proposal.leaves.map((l) => l.name), ...proposal.relations.flatMap((e) => [e.from, e.to]), ...proposal.contexts.map((c) => c.concept)])].join(', ')
  return `You minted the topic hierarchy for a flashcard, and some points came out in the wrong SHAPE. Fix only the points listed. Do not touch anything else.

Card: ${term}

Concept names already used on this card (reuse them as endpoints where they fit; never invent a name that describes a link instead of naming its ends):
${vocab}
${needEdge.length ? `\nPOINTS THAT MUST BE RELATIONS (a point about how two things connect is an edge between two standalone concept names — "net income" —precedes→ "retained earnings" — never a leaf called "net income retained earnings linkage"):\n${edgeLines}\n` : ''}${needLeaf.length ? `\nPOINTS THAT MUST HAVE A LEAF (a definition or quantity names a thing a learner can fail on its own):\n${leafLines}\n` : ''}
Edge types: ${RELATABLE_TYPES.join(', ')}. Endpoints are lowercase noun phrases, no articles.

Output JSON: { "relations": [ { "klpRef": number, "from": string, "to": string, "type": string } ], "leaves": [ { "klpRef": number, "name": string } ] }
One relation per listed point that must be a relation (two if the point states two links); one leaf per listed point that must have a leaf.`
}

/**
 * Fold a repair into the proposal: for each repaired ref, drop its leaf
 * membership (an edge point is not a leaf) and add the relation; add leaves
 * for the leaf repairs. Refs the repair did not cover are left as they were —
 * the statistic will still report them.
 */
export function applyRepair(proposal: CardTopicProposal, repair: MintRepair, report: EnforcementReport): CardTopicProposal {
  const edgeRefs = new Set(report.rows.filter((r) => r.violation && r.intended === 'edge').map((r) => r.ref))
  const repairedEdgeRefs = new Set(repair.relations.map((r) => r.klpRef).filter((ref) => edgeRefs.has(ref)))
  const leaves = proposal.leaves
    .map((l) => ({ ...l, klpRefs: l.klpRefs.filter((ref) => !repairedEdgeRefs.has(ref)) }))
    .filter((l) => l.klpRefs.length > 0)
  const leafRefs = new Set(report.rows.filter((r) => r.violation && r.intended === 'leaf').map((r) => r.ref))
  for (const l of repair.leaves) {
    if (!leafRefs.has(l.klpRef)) continue
    const existing = leaves.find((x) => x.name.toLowerCase() === l.name.toLowerCase())
    if (existing) existing.klpRefs.push(l.klpRef)
    else leaves.push({ name: l.name, klpRefs: [l.klpRef] })
  }
  const relations = [...proposal.relations, ...repair.relations.filter((r) => edgeRefs.has(r.klpRef)).map((r) => ({ klpRef: r.klpRef, from: r.from, to: r.to, type: r.type }))]
  return { ...proposal, leaves, relations }
}
