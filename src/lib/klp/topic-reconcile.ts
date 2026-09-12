/**
 * Reconciles two models' topic proposals for ONE card into one merged
 * proposal. PURE: no AI, no database, every decision carries a `reason`.
 *
 * Design: `docs/superpowers/specs/2026-09-11-dual-model-topic-minting-design.md`,
 * amended the same day after the first 13-card run (the "amendment" section).
 * Side A is DeepSeek, side B is Gemini. The owner's rules, in the order the
 * code applies them:
 *
 *   1. NOTHING A ADDS IS DROPPED FOR BEING EXTRA. Per KLP the merge keeps the
 *      larger count. B only REPLACES A's item of the SAME TYPE (edge for edge,
 *      leaf for leaf, context for context). An A-only extra is confirmed by the
 *      judge as a distinct thing, not a restatement, and otherwise kept.
 *   2. TYPE PRIORITY when the sides differ: edge > context > leaf. An edge
 *      always beats a leaf; the `kind` prior is a visible note, not a trigger.
 *   3. SAME TYPE, DIFFERENT CONTENT: same concept by rule -> the shorter name;
 *      else a container name loses to a non-container without a call (or WINS,
 *      on a `definition` KLP - the statement is the subject there); else the
 *      judge, and A wins only when the judge prefers A AND either says B's
 *      would be rejected outright or A's name is the shorter. Every tie leans B.
 *   4. THE OVERLY-BROAD CHECK ALWAYS RUNS. The one exception is a `definition`
 *      KLP, where the statement itself is the honest subject (rule 3 of the
 *      prompt) - flagged, never blocked.
 *
 * ALIGNMENT IS BY KLP INDEX, never by name. Both models saw the same numbered
 * KLP list, so only names and shapes need reconciling.
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
  s = s
    .split(/\s+/)
    .map((t) => ABBREVIATIONS[t.replace(/[.,;:()]/g, '')] ?? t)
    .join(' ')
  s = s.replace(/&/g, ' and ')
  s = s.replace(/-/g, '')
  s = s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  let tokens = s.split(' ').filter(Boolean).map(singular)
  if (tokens.length > 1 && NOISE_SUFFIXES.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1)
  if (tokens.length > 1 && NOISE_SUFFIXES.has(tokens[tokens.length - 1] + 's')) tokens = tokens.slice(0, -1)
  return tokens.join(' ')
}

function contentTokens(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter((t) => t && !FILLERS.has(t)))
}

/**
 * Same concept BY RULE: equal after normalization, or one name's content
 * tokens contain the other's with the smaller side at least two tokens.
 * Containment, not Jaccard: `effective tax rate` / `marginal tax rate` share a
 * head noun and neither contains the other, so containment refuses. The
 * two-token floor stops `assets` being swallowed by `long-term assets`.
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

/** A statement name, with or without a word added. */
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

export type ConflictKind = 'name_conflict' | 'edge_align' | 'extra_context'

export interface Conflict {
  klpRef: number
  conflictIndex: number
  kind: ConflictKind
  klpKind: string
  /** name_conflict: the two leaf names. */
  aName?: string
  bName?: string
  /** edge_align: the unmatched edges on each side. */
  aEdges?: EdgeDraft[]
  bEdges?: EdgeDraft[]
  /** extra_context: the A-only context, and what it must be distinct from. */
  concept?: string
  distinctFrom?: string[]
}

export interface MergedLeaf {
  name: string
  klpRefs: number[]
  reason: string
  source: Source
  container: boolean
  /** True when the container is the rule-3 exception (a `definition` KLP). */
  containerAllowed: boolean
}

export interface MergedEdge extends EdgeDraft {
  klpRef: number
  reason: string
  source: Source
  containerEndpoint: boolean
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
  notes: string[]
}

export interface ReconcileInput {
  klps: { kind: string }[]
  /** Side A — DeepSeek. */
  a: CardTopicProposal
  /** Side B — Gemini. */
  b: CardTopicProposal
  /** Normalized names already minted elsewhere in the run. */
  runVocabulary?: Set<string>
}

export interface Verdict {
  klpRef: number
  conflictIndex: number
  /** name_conflict */
  sameConcept?: boolean
  prefer?: 'a' | 'b'
  /** name_conflict: would a careful expert accept the OTHER mapping too? */
  otherAcceptable?: boolean
  /** edge_align: pairs (index into aEdges, index into bEdges) that are the same link. */
  sameLinks?: { a: number; b: number }[]
  /** extra_context: is the A-only context a distinct additional concept? */
  distinct?: boolean
}

// ---------------------------------------------------------------------------
// Per-side view of one KLP
// ---------------------------------------------------------------------------

interface SideView {
  leafName?: string
  edges: EdgeDraft[]
  contexts: string[]
  selfDup: boolean
}

function viewSide(p: CardTopicProposal, ref: number, label: 'a' | 'b', notes: string[]): SideView {
  const leaves = p.leaves.filter((l) => l.klpRefs.includes(ref))
  if (leaves.length > 1) notes.push(`klp ${ref}: side ${label} put it in ${leaves.length} leaves; using the first`)
  const leafName = leaves[0]?.name
  const edges = p.relations.filter((r) => r.klpRef === ref).map(({ from, to, type }) => ({ from, to, type }))
  const rawCtx = p.contexts.filter((c) => c.klpRef === ref).map((c) => c.concept)
  const own = new Set<string>()
  if (leafName) own.add(normalizeName(leafName))
  for (const e of edges) own.add(normalizeName(e.from)), own.add(normalizeName(e.to))
  const contexts: string[] = []
  let selfDup = false
  for (const c of rawCtx) {
    if (own.has(normalizeName(c))) {
      selfDup = true
      notes.push(`klp ${ref}: purge:self-dup side ${label} context "${c}"`)
    } else if (isContainerName(c)) {
      notes.push(`klp ${ref}: drop:container-context side ${label} "${c}"`)
    } else contexts.push(c)
  }
  return { leafName, edges, contexts, selfDup }
}

function edgeKey(e: EdgeDraft): string {
  return `${normalizeName(e.from)}|${normalizeName(e.to)}`
}

function edgeHasContainer(e: EdgeDraft): boolean {
  return isContainerName(e.from) || isContainerName(e.to)
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

interface LeafPick {
  name: string
  reason: string
  source: Source
  kind: string
}

interface Working {
  leafByRef: Map<number, LeafPick>
  edges: MergedEdge[]
  contexts: MergedContext[]
  conflicts: Conflict[]
  notes: string[]
}

function pushConflict(w: Working, c: Omit<Conflict, 'conflictIndex'>): void {
  w.conflicts.push({ ...c, conflictIndex: w.conflicts.length })
}

function addEdge(w: Working, ref: number, e: EdgeDraft, reason: string, source: Source): void {
  w.edges.push({ ...e, klpRef: ref, reason, source, containerEndpoint: edgeHasContainer(e) })
}

export function reconcileProposals(input: ReconcileInput): MergedProposal {
  const { klps, a, b } = input
  const w: Working = { leafByRef: new Map(), edges: [], contexts: [], conflicts: [], notes: [] }
  const pendingContexts: { ref: number; concept: string; source: 'a' | 'b' }[] = []

  for (let ref = 0; ref < klps.length; ref++) {
    const kind = klps[ref].kind
    const prior = EXPECTED_SHAPE[kind as KlpKind] ?? 'either'
    const va = viewSide(a, ref, 'a', w.notes)
    const vb = viewSide(b, ref, 'b', w.notes)
    for (const c of va.contexts) pendingContexts.push({ ref, concept: c, source: 'a' })
    for (const c of vb.contexts) pendingContexts.push({ ref, concept: c, source: 'b' })

    const anyEdge = va.edges.length > 0 || vb.edges.length > 0
    const anyLeaf = !!va.leafName || !!vb.leafName
    if (!anyEdge && !anyLeaf) {
      w.notes.push(`klp ${ref}: uncovered by both models`)
      continue
    }

    // ---- Edges: union with same-link replacement by B. ----
    if (anyEdge) reconcileEdges(w, ref, kind, va.edges, vb.edges)

    // ---- Leaf: survives beside edges only for the rule-3 definition case —
    // a `definition` KLP whose leaf IS the statement. Any other leaf loses to
    // an edge (type priority: edge > context > leaf). ----
    if (anyLeaf) {
      const statementDefinition =
        kind === 'definition' && [va.leafName, vb.leafName].some((n) => n && isContainerName(n))
      // Type priority settles a PURE difference: one side said only-leaf, the
      // other only-edge. If either side emitted BOTH a leaf and an edge, the
      // larger-count rule applies instead — the leaf is reconciled (Gemini's
      // replaces DeepSeek's, same type) and the edges are kept beside it.
      const aOnlyLeaf = !!va.leafName && va.edges.length === 0
      const bOnlyLeaf = !!vb.leafName && vb.edges.length === 0
      const aOnlyEdge = !va.leafName && va.edges.length > 0
      const bOnlyEdge = !vb.leafName && vb.edges.length > 0
      const pureSplit = (aOnlyLeaf && bOnlyEdge) || (bOnlyLeaf && aOnlyEdge)
      if (anyEdge && pureSplit && !statementDefinition) {
        const dropped = [va.leafName && `A "${va.leafName}"`, vb.leafName && `B "${vb.leafName}"`].filter(Boolean).join(', ')
        w.notes.push(
          `klp ${ref}: rule:edge-priority dropped leaf ${dropped}` +
            (prior === 'leaf' ? ` (kind_conflict: ${kind} expects a leaf)` : ''),
        )
      } else {
        reconcileLeaf(w, ref, kind, va, vb)
      }
    }
  }

  // ---- Contexts: union, B replaces same-name, A-only extras confirmed. ----
  const vocab = new Set<string>(input.runVocabulary ?? [])
  for (const l of w.leafByRef.values()) vocab.add(normalizeName(l.name))
  for (const e of w.edges) vocab.add(normalizeName(e.from)), vocab.add(normalizeName(e.to))
  const seen = new Map<string, { ref: number; concept: string; sources: Set<'a' | 'b'> }>()
  for (const c of pendingContexts) {
    const key = `${c.ref}|${normalizeName(c.concept)}`
    const e = seen.get(key) ?? { ref: c.ref, concept: c.concept, sources: new Set() }
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
    else {
      // A-only and new: kept unless the judge says it restates the point.
      const distinctFrom = [
        ...(ownLeaf ? [ownLeaf.name] : []),
        ...w.edges.filter((x) => x.klpRef === e.ref).map((x) => `${x.from} -> ${x.to}`),
        ...w.contexts.filter((x) => x.klpRef === e.ref).map((x) => x.concept),
      ]
      pushConflict(w, { klpRef: e.ref, kind: 'extra_context', klpKind: klps[e.ref].kind, concept: e.concept, distinctFrom })
    }
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

function reconcileLeaf(w: Working, ref: number, kind: string, va: SideView, vb: SideView): void {
  const aName = va.leafName
  const bName = vb.leafName
  if (aName && !bName) return void w.leafByRef.set(ref, { name: aName, reason: 'rule:only-coverage', source: 'a', kind })
  if (bName && !aName) return void w.leafByRef.set(ref, { name: bName, reason: 'rule:only-coverage', source: 'b', kind })
  if (!aName || !bName) return
  if (sameConceptByRule(aName, bName)) {
    const pick = pickShorter(aName, bName)
    w.leafByRef.set(ref, {
      name: pick.name,
      reason: pick.reason,
      source: normalizeName(aName) === normalizeName(bName) ? 'both' : pick.source,
      kind,
    })
    return
  }
  // The overly-broad check, as a rule: a container loses to a non-container
  // without a call. The rule-3 exception is its mirror image: on a
  // `definition` KLP the statement IS the subject, so the statement wins over
  // the noun the other model happened to mention ("income statement" over
  // "net income" for "the income statement captures profitability...").
  const ca = isContainerName(aName)
  const cb = isContainerName(bName)
  if (ca !== cb) {
    const containerWins = kind === 'definition'
    const reason = containerWins ? 'rule:statement-definition' : 'rule:avoid-container'
    const pickA = ca === containerWins
    w.leafByRef.set(ref, pickA
      ? { name: aName, reason, source: 'a', kind }
      : { name: bName, reason, source: 'b', kind })
    return
  }
  pushConflict(w, { klpRef: ref, kind: 'name_conflict', klpKind: kind, aName, bName })
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
    if (x.type === y.type) addEdge(w, ref, y, 'rule:edge-both', 'both')
    else addEdge(w, ref, y, 'rule:type-gemini', 'b')
  }
  if (unmatchedA.length > 0 && unmatchedB.length > 0) {
    // One-to-one and one side has a container endpoint the other lacks: the
    // overly-broad check settles it without a call.
    if (unmatchedA.length === 1 && unmatchedB.length === 1) {
      const ca = edgeHasContainer(unmatchedA[0])
      const cb = edgeHasContainer(unmatchedB[0])
      if (ca !== cb) {
        if (ca) addEdge(w, ref, unmatchedB[0], 'rule:avoid-container-endpoint', 'b')
        else addEdge(w, ref, unmatchedA[0], 'rule:avoid-container-endpoint', 'a')
        return
      }
    }
    pushConflict(w, { klpRef: ref, kind: 'edge_align', klpKind: kind, aEdges: unmatchedA, bEdges: unmatchedB })
    return
  }
  for (const e of unmatchedB) addEdge(w, ref, e, 'rule:gemini-extra-edge', 'b')
  for (const e of unmatchedA) addEdge(w, ref, e, 'rule:ds-extra-edge', 'a')
}

function regroupLeaves(leafByRef: Map<number, LeafPick>): MergedLeaf[] {
  const byName = new Map<string, MergedLeaf>()
  for (const [ref, l] of [...leafByRef.entries()].sort((x, y) => x[0] - y[0])) {
    const key = normalizeName(l.name)
    const existing = byName.get(key)
    if (existing) {
      existing.klpRefs.push(ref)
      if (wordCount(l.name) < wordCount(existing.name)) existing.name = l.name
      if (l.kind !== 'definition') existing.containerAllowed = false
      continue
    }
    const container = isContainerName(l.name)
    byName.set(key, {
      name: l.name,
      klpRefs: [ref],
      reason: l.reason,
      source: l.source,
      container,
      containerAllowed: container && l.kind === 'definition',
    })
  }
  return [...byName.values()]
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/**
 * Resolves the judge's verdicts. The WEIGHTING lives here, not in the judge:
 *  - name_conflict: same concept -> shorter; else A wins only if the judge
 *    prefers A AND says B's mapping would be rejected outright. Missing
 *    verdict -> B (`fallback:gemini`).
 *  - edge_align: B's edge replaces the A edge the judge says is the same link;
 *    every other edge on both sides is kept. Missing verdict -> keep all
 *    (`fallback:keep-both`), because nothing A adds is dropped for being extra.
 *  - extra_context: kept unless the judge says it restates. Missing verdict ->
 *    kept (`fallback:keep-extra`).
 * Every fallback is written to `notes`.
 */
export function applyVerdicts(merged: MergedProposal, verdicts: Verdict[]): MergedProposal {
  const leafByRef = new Map<number, LeafPick>()
  for (const l of merged.leaves) for (const ref of l.klpRefs) {
    leafByRef.set(ref, { name: l.name, reason: l.reason, source: l.source, kind: l.containerAllowed ? 'definition' : 'other' })
  }
  const w: Working = { leafByRef, edges: [...merged.relations], contexts: [...merged.contexts], conflicts: [], notes: [...merged.notes] }

  for (const c of merged.conflicts) {
    const v = verdicts.find((x) => x.klpRef === c.klpRef && x.conflictIndex === c.conflictIndex)
    if (c.kind === 'name_conflict') {
      let pick: LeafPick
      if (!v) {
        pick = { name: c.bName!, reason: 'fallback:gemini', source: 'b', kind: c.klpKind }
        w.notes.push(`klp ${c.klpRef}: fallback:gemini — no verdict for name_conflict`)
      } else if (v.sameConcept) {
        const p = pickShorter(c.aName!, c.bName!)
        pick = { name: p.name, reason: 'judge:same-concept→shorter', source: p.source, kind: c.klpKind }
      } else if (v.prefer === 'a' && v.otherAcceptable === false) {
        pick = { name: c.aName!, reason: 'judge:ds-clear', source: 'a', kind: c.klpKind }
      } else if (v.prefer === 'a' && wordCount(c.aName!) < wordCount(c.bName!)) {
        // "Slightly weighted toward Gemini": DeepSeek needs two of the owner's
        // priors at once (the judge prefers it AND its name is the shorter);
        // Gemini needs one. Measured 2026-09-11: "outright wrong" alone was
        // 0 of 11, "clear" alone was 18 of 19 — neither is a slight lean.
        pick = { name: c.aName!, reason: 'judge:ds-preferred+shorter', source: 'a', kind: c.klpKind }
      } else {
        pick = { name: c.bName!, reason: 'judge:gemini-weighted', source: 'b', kind: c.klpKind }
      }
      w.leafByRef.set(c.klpRef, pick)
    } else if (c.kind === 'edge_align') {
      const aE = c.aEdges ?? []
      const bE = c.bEdges ?? []
      if (!v) {
        w.notes.push(`klp ${c.klpRef}: fallback:keep-both — no verdict for edge_align`)
        for (const e of bE) addEdge(w, c.klpRef, e, 'fallback:keep-both', 'b')
        for (const e of aE) addEdge(w, c.klpRef, e, 'fallback:keep-both', 'a')
        continue
      }
      const replacedA = new Set<number>()
      const usedB = new Set<number>()
      for (const link of v.sameLinks ?? []) {
        if (link.a < 0 || link.a >= aE.length || link.b < 0 || link.b >= bE.length) continue
        if (replacedA.has(link.a) || usedB.has(link.b)) continue
        replacedA.add(link.a)
        usedB.add(link.b)
        addEdge(w, c.klpRef, bE[link.b], 'judge:same-link→gemini', 'b')
      }
      bE.forEach((e, i) => { if (!usedB.has(i)) addEdge(w, c.klpRef, e, 'judge:distinct-extra', 'b') })
      aE.forEach((e, i) => { if (!replacedA.has(i)) addEdge(w, c.klpRef, e, 'judge:distinct-extra', 'a') })
    } else if (c.kind === 'extra_context') {
      if (!v) {
        w.contexts.push({ klpRef: c.klpRef, concept: c.concept!, reason: 'fallback:keep-extra', source: 'a' })
        w.notes.push(`klp ${c.klpRef}: fallback:keep-extra — no verdict for extra_context "${c.concept}"`)
      } else if (v.distinct === false) {
        w.notes.push(`klp ${c.klpRef}: judge:extra-dropped "${c.concept}" (restates)`)
      } else {
        w.contexts.push({ klpRef: c.klpRef, concept: c.concept!, reason: 'judge:extra-kept', source: 'a' })
      }
    }
  }

  return {
    ...merged,
    leaves: regroupLeaves(w.leafByRef),
    relations: w.edges,
    contexts: w.contexts,
    conflicts: [],
    notes: w.notes,
  }
}
