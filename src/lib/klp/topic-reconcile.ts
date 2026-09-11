/**
 * Reconciles two models' topic proposals for ONE card into one merged
 * proposal. PURE: no AI, no database, every decision carries a `reason`.
 *
 * Design: `docs/superpowers/specs/2026-09-11-dual-model-topic-minting-design.md`.
 * Side A is DeepSeek, side B is Gemini — the asymmetry is deliberate and is
 * the owner's read of the Part F grid: when the two disagree on the TYPE of a
 * thing, Gemini is usually right; when they name the same thing differently,
 * the shorter name is usually right. Every tie-break here leans B.
 *
 * ALIGNMENT IS BY KLP INDEX, never by name. Both models saw the same numbered
 * KLP list, so "are they talking about the same point" is already answered.
 * Only names and shapes need reconciling, and most of that is settled by rule
 * — the judge sees only what the rules could not settle.
 */
import { EXPECTED_SHAPE, type CardTopicProposal, type KlpKind, type RelatableType } from './topic-minting'

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Whole-token expansions applied before comparison. Comparison only — the
 * merged output keeps the model's ORIGINAL spelling. */
const ABBREVIATIONS: Record<string, string> = {
  ebitda: 'earnings before interest taxes depreciation and amortization',
  ebit: 'earnings before interest and taxes',
  'd&a': 'depreciation and amortization',
  fcf: 'free cash flow',
  'pp&e': 'property plant and equipment',
  ppe: 'property plant and equipment',
  sbc: 'stock based compensation',
  cogs: 'cost of goods sold',
  ni: 'net income',
  ocf: 'operating cash flow',
  capex: 'capital expenditures',
  wc: 'working capital',
  nwc: 'net working capital',
  ev: 'enterprise value',
  dscr: 'debt service coverage ratio',
  fccr: 'fixed charge coverage ratio',
}

/**
 * A trailing word that describes the name rather than naming the thing.
 * `gross profit calculation` IS `gross profit`. Only ONE is stripped, and
 * never from a one-word name, so `structure` stays `structure`.
 */
export const NOISE_SUFFIXES = new Set([
  'concept',
  'calculation',
  'definition',
  'structure',
  'mechanics',
  'derivation',
  'purpose',
  'components',
  'overview',
  'basics',
])

const FILLERS = new Set(['of', 'the', 'and', 'to', 'in', 'on', 'for', 'a', 'an', 'vs', 'versus'])

function singular(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) {
    return token.slice(0, -1)
  }
  return token
}

export function normalizeName(raw: string): string {
  let s = raw.toLowerCase().trim()
  // Expand abbreviations on whole tokens BEFORE punctuation is stripped, so
  // `d&a` and `pp&e` are still recognisable.
  s = s
    .split(/\s+/)
    .map((t) => ABBREVIATIONS[t.replace(/[.,;:()]/g, '')] ?? t)
    .join(' ')
  s = s.replace(/&/g, ' and ')
  s = s.replace(/-/g, '') // non-cash -> noncash, add-backs -> addbacks
  s = s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  let tokens = s.split(' ').filter(Boolean).map(singular)
  if (tokens.length > 1 && NOISE_SUFFIXES.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1)
  // `components` singularises to `component`; check the singular form too.
  if (tokens.length > 1 && NOISE_SUFFIXES.has(tokens[tokens.length - 1] + 's')) tokens = tokens.slice(0, -1)
  return tokens.join(' ')
}

function contentTokens(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter((t) => t && !FILLERS.has(t)))
}

/**
 * Same concept BY RULE: equal after normalization, or one name's content
 * tokens contain the other's with the smaller side at least two tokens.
 *
 * Containment, not Jaccard: Part E's token-overlap pass merged `effective tax
 * rate` with `marginal tax rate`, and those share a head noun too, so a
 * head-noun guard would not have saved it. Neither contains the other, so
 * containment refuses. The two-token floor stops `assets` being swallowed by
 * `long-term assets`. Everything this refuses goes to the judge — the rule is
 * biased toward NOT merging, as the spec requires.
 */
export function sameConceptByRule(x: string, y: string): boolean {
  const nx = normalizeName(x)
  const ny = normalizeName(y)
  if (nx === ny) return true
  const tx = contentTokens(nx)
  const ty = contentTokens(ny)
  const [small, big] = tx.size <= ty.size ? [tx, ty] : [ty, tx]
  if (small.size < 2) return false
  for (const t of small) if (!big.has(t)) return false
  return true
}

const CONTAINER_EXACT = new Set([
  'income statement',
  'cash flow statement',
  'balance sheet',
  'leverage',
  'financial metric',
  'accounting',
  'technical',
  'valuation',
  'statement',
  'finance',
  'financial statement',
])
const CONTAINER_STEM = /^(income statement|cash flow statement|balance sheet|financial statement)( |$)/

/** A statement name, with or without a word added. Qwen's `cash flow statement
 * mechanics` is the case the exact list missed. */
export function isContainerName(raw: string): boolean {
  const n = normalizeName(raw)
  return CONTAINER_EXACT.has(n) || CONTAINER_STEM.test(n)
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

/** Shorter original wins; tie goes to B. */
function pickShorter(aName: string, bName: string): { name: string; reason: string; source: Source } {
  const wa = wordCount(aName)
  const wb = wordCount(bName)
  if (wa < wb) return { name: aName, reason: 'rule:shorter', source: 'a' }
  if (wb < wa) return { name: bName, reason: 'rule:shorter', source: 'b' }
  return { name: bName, reason: 'rule:tie-gemini', source: 'b' }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Source = 'a' | 'b' | 'both'

export interface EdgeDraft {
  from: string
  to: string
  type: RelatableType
}

export interface Candidate {
  shape: 'leaf' | 'edge'
  name?: string
  edges?: EdgeDraft[]
}

export interface Conflict {
  klpRef: number
  /** Index within `MergedProposal.conflicts` at the time of creation; stable
   * across `applyVerdicts` so a verdict can address it. */
  conflictIndex: number
  kind: 'name_conflict' | 'kind_conflict' | 'edge_conflict'
  klpKind: string
  a: Candidate
  b: Candidate
}

export interface MergedLeaf {
  name: string
  klpRefs: number[]
  reason: string
  source: Source
  container: boolean
}

export interface MergedEdge extends EdgeDraft {
  klpRef: number
  reason: string
  source: Source
}

export interface MergedContext {
  klpRef: number
  concept: string
  reason: string
  source: Source
}

export interface MergedProposal {
  parent: string
  parentReason: string
  leaves: MergedLeaf[]
  relations: MergedEdge[]
  contexts: MergedContext[]
  conflicts: Conflict[]
  /** Everything dropped or noticed, one line each, for the run report. */
  notes: string[]
}

export interface ReconcileInput {
  /** The card's KLPs by index; only `kind` is read. */
  klps: { kind: string }[]
  /** Side A — DeepSeek. */
  a: CardTopicProposal
  /** Side B — Gemini. */
  b: CardTopicProposal
  /** Normalized names already minted elsewhere in the run (leaves and edge
   * endpoints of other cards). A DeepSeek-only context survives if it is here. */
  runVocabulary?: Set<string>
}

export interface Verdict {
  klpRef: number
  conflictIndex: number
  sameConcept: boolean
  prefer?: 'a' | 'b'
  strength?: 'clear' | 'slight'
}

// ---------------------------------------------------------------------------
// Per-side view of one KLP
// ---------------------------------------------------------------------------

interface SideView {
  leafName?: string
  edges: EdgeDraft[]
  contexts: string[]
  selfDup: boolean
  shape?: 'leaf' | 'edge'
}

function viewSide(p: CardTopicProposal, ref: number, label: 'a' | 'b', notes: string[]): SideView {
  const leaves = p.leaves.filter((l) => l.klpRefs.includes(ref))
  if (leaves.length > 1) notes.push(`klp ${ref}: side ${label} put it in ${leaves.length} leaves; using the first`)
  const leafName = leaves[0]?.name
  const edges = p.relations.filter((r) => r.klpRef === ref).map(({ from, to, type }) => ({ from, to, type }))
  const rawCtx = p.contexts.filter((c) => c.klpRef === ref).map((c) => c.concept)
  // Self-duplicate purge: a context that names the model's own leaf or edge
  // endpoint on the same KLP is a mislabel, and the owner's read is that the
  // point probably wants an edge. Drop the context, remember the suspicion.
  const own = new Set<string>()
  if (leafName) own.add(normalizeName(leafName))
  for (const e of edges) own.add(normalizeName(e.from)), own.add(normalizeName(e.to))
  const contexts: string[] = []
  let selfDup = false
  for (const c of rawCtx) {
    if (own.has(normalizeName(c))) {
      selfDup = true
      notes.push(`klp ${ref}: purge:self-dup side ${label} context "${c}"`)
    } else contexts.push(c)
  }
  let shape: SideView['shape']
  if (edges.length > 0) {
    shape = 'edge'
    if (leafName) notes.push(`klp ${ref}: side ${label} emitted both a leaf and an edge; counted as edge`)
  } else if (leafName) shape = 'leaf'
  return { leafName: shape === 'leaf' ? leafName : undefined, edges, contexts, selfDup, shape }
}

function edgeKey(e: EdgeDraft): string {
  return `${normalizeName(e.from)}|${normalizeName(e.to)}`
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

interface Working {
  leafByRef: Map<number, { name: string; reason: string; source: Source }>
  edges: MergedEdge[]
  contexts: MergedContext[]
  conflicts: Conflict[]
  notes: string[]
}

export function reconcileProposals(input: ReconcileInput): MergedProposal {
  const { klps, a, b } = input
  const w: Working = { leafByRef: new Map(), edges: [], contexts: [], conflicts: [], notes: [] }
  const pendingContexts: { ref: number; concept: string; source: 'a' | 'b' }[] = []

  for (let ref = 0; ref < klps.length; ref++) {
    const kind = klps[ref].kind as KlpKind
    const prior = EXPECTED_SHAPE[kind] ?? 'either'
    const va = viewSide(a, ref, 'a', w.notes)
    const vb = viewSide(b, ref, 'b', w.notes)
    for (const c of va.contexts) pendingContexts.push({ ref, concept: c, source: 'a' })
    for (const c of vb.contexts) pendingContexts.push({ ref, concept: c, source: 'b' })

    if (!va.shape && !vb.shape) {
      w.notes.push(`klp ${ref}: uncovered by both models`)
      continue
    }
    if (!va.shape || !vb.shape) {
      const v = va.shape ? va : vb
      const src: Source = va.shape ? 'a' : 'b'
      takeSide(w, ref, v, src, 'rule:only-coverage')
      continue
    }

    if (va.shape === vb.shape) {
      if (va.shape === 'leaf') reconcileLeafNames(w, ref, kind, va.leafName!, vb.leafName!)
      else reconcileEdges(w, ref, kind, va.edges, vb.edges)
      continue
    }

    // Split: one leaf, one edge.
    const leafSide = va.shape === 'leaf' ? va : vb
    const edgeSide = va.shape === 'edge' ? va : vb
    const edgeSrc: Source = va.shape === 'edge' ? 'a' : 'b'
    if (leafSide.selfDup) {
      takeSide(w, ref, edgeSide, edgeSrc, 'rule:edge-wins-self-dup')
    } else if (prior === 'edge' || prior === 'either') {
      takeSide(w, ref, edgeSide, edgeSrc, 'rule:edge-wins-by-kind')
    } else {
      w.conflicts.push({
        klpRef: ref,
        conflictIndex: w.conflicts.length,
        kind: 'kind_conflict',
        klpKind: kind,
        a: va.shape === 'leaf' ? { shape: 'leaf', name: va.leafName } : { shape: 'edge', edges: va.edges },
        b: vb.shape === 'leaf' ? { shape: 'leaf', name: vb.leafName } : { shape: 'edge', edges: vb.edges },
      })
    }
  }

  // Contexts: both -> keep; Gemini -> keep; DeepSeek-only -> keep iff already
  // in the vocabulary (this card's merged names or the run's). A context that
  // names the KLP's own merged leaf is a cross-model self-dup and is dropped.
  const vocab = new Set<string>(input.runVocabulary ?? [])
  for (const l of w.leafByRef.values()) vocab.add(normalizeName(l.name))
  for (const e of w.edges) vocab.add(normalizeName(e.from)), vocab.add(normalizeName(e.to))
  const seen = new Map<string, { ref: number; concept: string; sources: Set<'a' | 'b'> }>()
  for (const c of pendingContexts) {
    const key = `${c.ref}|${normalizeName(c.concept)}`
    const e = seen.get(key) ?? { ref: c.ref, concept: c.concept, sources: new Set() }
    // Prefer Gemini's spelling when both wrote it.
    if (c.source === 'b') e.concept = c.concept
    e.sources.add(c.source)
    seen.set(key, e)
  }
  for (const e of seen.values()) {
    const n = normalizeName(e.concept)
    const ownLeaf = w.leafByRef.get(e.ref)
    if (ownLeaf && normalizeName(ownLeaf.name) === n) {
      w.notes.push(`klp ${e.ref}: drop:ctx-equals-merged-leaf "${e.concept}"`)
      continue
    }
    if (e.sources.size === 2) w.contexts.push({ klpRef: e.ref, concept: e.concept, reason: 'rule:ctx-both', source: 'both' })
    else if (e.sources.has('b')) w.contexts.push({ klpRef: e.ref, concept: e.concept, reason: 'rule:ctx-gemini', source: 'b' })
    else if (vocab.has(n)) w.contexts.push({ klpRef: e.ref, concept: e.concept, reason: 'rule:ctx-in-vocab', source: 'a' })
    else w.notes.push(`klp ${e.ref}: drop:ds-only-novel context "${e.concept}"`)
  }

  const parent = pickShorter(a.parent, b.parent)
  return {
    parent: parent.name,
    parentReason: parent.reason,
    leaves: regroupLeaves(w.leafByRef),
    relations: w.edges,
    contexts: w.contexts,
    conflicts: w.conflicts,
    notes: w.notes,
  }
}

function takeSide(w: Working, ref: number, v: SideView, source: Source, reason: string): void {
  if (v.shape === 'leaf') w.leafByRef.set(ref, { name: v.leafName!, reason, source })
  else for (const e of v.edges) w.edges.push({ ...e, klpRef: ref, reason, source })
}

function reconcileLeafNames(w: Working, ref: number, kind: string, aName: string, bName: string): void {
  if (sameConceptByRule(aName, bName)) {
    const pick = pickShorter(aName, bName)
    w.leafByRef.set(ref, { name: pick.name, reason: pick.reason, source: normalizeName(aName) === normalizeName(bName) ? 'both' : pick.source })
    return
  }
  w.conflicts.push({
    klpRef: ref,
    conflictIndex: w.conflicts.length,
    kind: 'name_conflict',
    klpKind: kind,
    a: { shape: 'leaf', name: aName },
    b: { shape: 'leaf', name: bName },
  })
}

function reconcileEdges(w: Working, ref: number, kind: string, ea: EdgeDraft[], eb: EdgeDraft[]): void {
  const unmatchedA = [...ea]
  const unmatchedB = [...eb]
  for (const x of ea) {
    const j = unmatchedB.findIndex((y) => edgeKey(y) === edgeKey(x))
    if (j < 0) continue
    const y = unmatchedB[j]
    unmatchedB.splice(j, 1)
    unmatchedA.splice(unmatchedA.indexOf(x), 1)
    if (x.type === y.type) w.edges.push({ ...y, klpRef: ref, reason: 'rule:edge-both', source: 'both' })
    else w.edges.push({ ...y, klpRef: ref, reason: 'rule:type-gemini', source: 'b' })
  }
  if (unmatchedA.length > 0 && unmatchedB.length > 0) {
    w.conflicts.push({
      klpRef: ref,
      conflictIndex: w.conflicts.length,
      kind: 'edge_conflict',
      klpKind: kind,
      a: { shape: 'edge', edges: unmatchedA },
      b: { shape: 'edge', edges: unmatchedB },
    })
    return
  }
  for (const e of unmatchedB) w.edges.push({ ...e, klpRef: ref, reason: 'rule:gemini-extra-edge', source: 'b' })
  for (const e of unmatchedA) w.edges.push({ ...e, klpRef: ref, reason: 'rule:ds-extra-edge', source: 'a' })
}

/** KLPs whose merged names coincide share one leaf — this is where a fused
 * leaf can legitimately appear, from two models each naming one KLP. */
function regroupLeaves(leafByRef: Map<number, { name: string; reason: string; source: Source }>): MergedLeaf[] {
  const byName = new Map<string, MergedLeaf>()
  for (const [ref, l] of [...leafByRef.entries()].sort((x, y) => x[0] - y[0])) {
    const key = normalizeName(l.name)
    const existing = byName.get(key)
    if (existing) {
      existing.klpRefs.push(ref)
      if (wordCount(l.name) < wordCount(existing.name)) existing.name = l.name
      continue
    }
    byName.set(key, { name: l.name, klpRefs: [ref], reason: l.reason, source: l.source, container: isContainerName(l.name) })
  }
  return [...byName.values()]
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/**
 * Resolves the judge's verdicts into the merged proposal. The WEIGHTING lives
 * here, not in the judge: Gemini wins unless the judge prefers DeepSeek and
 * says so clearly. A missing verdict (call failed, item skipped) resolves to
 * Gemini and is written to `notes` — a silent fallback would be
 * indistinguishable from a judgement.
 */
export function applyVerdicts(merged: MergedProposal, verdicts: Verdict[]): MergedProposal {
  const leafByRef = new Map<number, { name: string; reason: string; source: Source }>()
  for (const l of merged.leaves) for (const ref of l.klpRefs) leafByRef.set(ref, { name: l.name, reason: l.reason, source: l.source })
  const edges = [...merged.relations]
  const notes = [...merged.notes]

  for (const c of merged.conflicts) {
    const v = verdicts.find((x) => x.klpRef === c.klpRef && x.conflictIndex === c.conflictIndex)
    let side: 'a' | 'b'
    let reason: string
    if (!v) {
      side = 'b'
      reason = 'fallback:gemini'
      notes.push(`klp ${c.klpRef}: fallback:gemini — no verdict for ${c.kind}`)
    } else if (v.sameConcept && c.kind === 'name_conflict') {
      const pick = pickShorter(c.a.name!, c.b.name!)
      side = pick.source === 'a' ? 'a' : 'b'
      reason = 'judge:same-concept→shorter'
    } else if (v.sameConcept) {
      side = 'b'
      reason = 'judge:same-concept→gemini'
    } else if (v.prefer === 'a' && v.strength === 'clear') {
      side = 'a'
      reason = 'judge:ds-clear'
    } else {
      side = 'b'
      reason = 'judge:gemini-weighted'
    }
    const cand = c[side]
    if (cand.shape === 'leaf') leafByRef.set(c.klpRef, { name: cand.name!, reason, source: side })
    else for (const e of cand.edges ?? []) edges.push({ ...e, klpRef: c.klpRef, reason, source: side })
  }

  return {
    ...merged,
    leaves: regroupLeaves(leafByRef),
    relations: edges,
    conflicts: [],
    notes,
  }
}
