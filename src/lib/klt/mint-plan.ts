/**
 * The WRITE STEP of topic minting (BUILD-QUEUE item 2), PLANNING half: turns one
 * card's reconciled topic proposal into the exact rows to persist. Pure - no
 * database import - so it is testable and printable. Persistence is
 * `mint-write.ts`.
 *
 * Planning is PURE and lives in `planMintWrites`; persistence is
 * `persistMintWrites`. The split is the same one `resolve.ts` /
 * `applyKltWrites` make for the legacy summariser, and for the same reason:
 * the plan can be printed, diffed and tested without a database, and the
 * operator can read exactly what a `--write` will do before it does it.
 *
 * WHAT IS WRITTEN, per card:
 *   - `Klt` rows (global vocabulary), upserted by `normalizedName` — the
 *     existing rule, so an exact-name match anywhere in the corpus REUSES the
 *     concept. Within the SAME set, a containment match (`sameConceptByRule`:
 *     "fundamental accounting equation" ⊇ "accounting equation") also reuses
 *     the existing node rather than minting a sibling. Across sets, only exact.
 *   - `SetKltNode` placement via `applyPaths`: the card's parent becomes a root
 *     of the set if new; leaves and contexts go under it. A leaf that already
 *     sits elsewhere in the set stays where it is. Edge ENDPOINTS get a `Klt`
 *     row but NO placement — an endpoint like `retained earnings` belongs
 *     under the balance sheet, not under "three-statement linkages", and the
 *     tree-aware placement pass (`placeUnparentedConcepts`) is the honest
 *     way to put it there. The plan reports them as `unplaced`.
 *   - `KlpTopic` rows: rank 1 for the leaf, rank 2 for each context. The
 *     card's live KLPs have their existing links REPLACED (delete + create),
 *     which is what makes a re-run idempotent and what re-attaches the KLPs
 *     that `author-klps` orphaned.
 *   - `KltRelation` rows, provenance `minted`, upserted on (from, to, type)
 *     with the card and KLP ids MERGED in — the evidence count grows with
 *     every card that produces the same edge. A directed edge that would close
 *     a cycle with the edges already stored is SKIPPED and reported, never
 *     written.
 *   - `Card.kltStatus = 'ready'`.
 *
 * NOT written: anything about mastery. `KlpTopic` is what `rollUpKltLinks`
 * reads, so writing links changes which topic a key point's evidence rolls
 * up to — that is the point — but no `KlpState` is touched.
 */
import { normalizeKltName, parseKltName, MAX_KLT_WORDS } from './normalize'
import type { MergedProposal } from '@/lib/klp/topic-reconcile'
import { sameConceptByRule, contractAbbreviation } from '@/lib/klp/topic-reconcile'
import { DIRECTED_TYPES } from '@/lib/klp/relations'

export interface ExistingSetName {
  name: string
  normalizedName: string
}

export interface PlannedConcept {
  name: string
  normalizedName: string
  role: 'parent' | 'leaf' | 'context' | 'endpoint'
  /** Set when a same-set containment match replaced the minted name. */
  reusedFrom?: string
}

export interface PlannedRelation {
  from: string
  to: string
  type: string
  klpIds: string[]
}

export interface MintWritePlan {
  cardId: string
  concepts: PlannedConcept[]
  /** Placement paths for `applyPaths`, parent-first. */
  paths: string[][]
  klpTopics: { klpId: string; normalizedName: string; rank: 1 | 2 }[]
  relations: PlannedRelation[]
  unplaced: string[]
  notes: string[]
}

export interface PlanInput {
  cardId: string
  /** Live KLP ids in KLP index order — index i is `klpRef` i in the proposal. */
  klpIds: string[]
  merged: MergedProposal
  /** Names already in THIS set's tree, for containment reuse. */
  existingSetNames: ExistingSetName[]
}

/**
 * Resolves a minted name to the name that will be written: an existing
 * same-set concept the minted name is the same as by rule, else itself.
 * Exact matches are left to the upsert; this is only the containment case.
 */
function resolveName(raw: string, existing: ExistingSetName[]): { name: string; reusedFrom?: string } {
  const parsed = parseKltName(raw)
  if (!parsed) return { name: raw }
  const exact = existing.find((e) => e.normalizedName === parsed.normalizedName)
  if (exact) return { name: exact.name }
  const byRule = existing.find((e) => sameConceptByRule(raw, e.name))
  if (byRule) return { name: byRule.name, reusedFrom: raw }
  return { name: parsed.name }
}

export function planMintWrites(input: PlanInput): MintWritePlan {
  const { cardId, klpIds, merged, existingSetNames } = input
  const plan: MintWritePlan = { cardId, concepts: [], paths: [], klpTopics: [], relations: [], unplaced: [], notes: [] }
  const seen = new Map<string, PlannedConcept>()
  const add = (raw: string, role: PlannedConcept['role']): PlannedConcept | null => {
    const r = resolveName(raw, existingSetNames)
    let parsed = parseKltName(r.name)
    if (!parsed) {
      // Too long for a concept name: a spelled-out abbreviation contracts.
      const abbr = contractAbbreviation(r.name)
      parsed = abbr ? parseKltName(abbr) : null
      if (parsed) plan.notes.push(`"${raw}" written as "${parsed.name}" (concept names are at most ${MAX_KLT_WORDS} words)`)
    }
    if (!parsed) {
      plan.notes.push(`unusable name "${raw}" (${role}); skipped`)
      return null
    }
    const existing = seen.get(parsed.normalizedName)
    if (existing) return existing
    const c: PlannedConcept = { name: parsed.name, normalizedName: parsed.normalizedName, role, ...(r.reusedFrom ? { reusedFrom: r.reusedFrom } : {}) }
    if (r.reusedFrom) plan.notes.push(`"${raw}" reuses same-set concept "${parsed.name}"`)
    seen.set(parsed.normalizedName, c)
    plan.concepts.push(c)
    return c
  }

  const parent = add(merged.parent, 'parent')
  if (parent) plan.paths.push([parent.name])

  for (const leaf of merged.leaves) {
    const c = add(leaf.name, 'leaf')
    if (!c) continue
    if (parent && c !== parent) plan.paths.push([parent.name, c.name])
    for (const ref of leaf.klpRefs) {
      const klpId = klpIds[ref]
      if (!klpId) {
        plan.notes.push(`leaf "${leaf.name}" refers to KLP ${ref}, which the card does not have`)
        continue
      }
      plan.klpTopics.push({ klpId, normalizedName: c.normalizedName, rank: 1 })
    }
  }

  for (const ctx of merged.contexts) {
    const c = add(ctx.concept, 'context')
    if (!c) continue
    const klpId = klpIds[ctx.klpRef]
    if (!klpId) continue
    if (parent && c !== parent) plan.paths.push([parent.name, c.name])
    // A context that duplicates the KLP's own leaf link is dropped here too —
    // the reconciler already does this, but a plan must not depend on it.
    if (plan.klpTopics.some((t) => t.klpId === klpId && t.normalizedName === c.normalizedName)) continue
    plan.klpTopics.push({ klpId, normalizedName: c.normalizedName, rank: 2 })
  }

  for (const rel of merged.relations) {
    const from = add(rel.from, 'endpoint')
    const to = add(rel.to, 'endpoint')
    if (!from || !to) continue
    if (from === to) {
      plan.notes.push(`self-edge ${rel.from} --${rel.type}--> ${rel.to} skipped`)
      continue
    }
    const klpId = klpIds[rel.klpRef]
    const key = `${from.normalizedName}|${to.normalizedName}|${rel.type}`
    const existing = plan.relations.find((r) => `${r.from}|${r.to}|${r.type}` === key)
    if (existing) {
      if (klpId && !existing.klpIds.includes(klpId)) existing.klpIds.push(klpId)
      continue
    }
    plan.relations.push({ from: from.normalizedName, to: to.normalizedName, type: rel.type, klpIds: klpId ? [klpId] : [] })
  }

  // Endpoints that are neither a leaf nor a context of this card get no
  // placement — see the module comment.
  for (const c of plan.concepts) if (c.role === 'endpoint') plan.unplaced.push(c.name)

  // Dedupe paths, keep order.
  const pathKeys = new Set<string>()
  plan.paths = plan.paths.filter((p) => {
    const k = p.map(normalizeKltName).join('>')
    if (pathKeys.has(k)) return false
    pathKeys.add(k)
    return true
  })
  return plan
}

// ---------------------------------------------------------------------------
// Acyclicity over the directed relation types
// ---------------------------------------------------------------------------

export interface DirectedEdge {
  from: string
  to: string
}

/** True when adding `from -> to` would close a cycle over `existing`. */
export function wouldCycleRelations(existing: DirectedEdge[], from: string, to: string): boolean {
  if (from === to) return true
  const adj = new Map<string, string[]>()
  for (const e of existing) {
    const list = adj.get(e.from) ?? []
    list.push(e.to)
    adj.set(e.from, list)
  }
  // Is `from` reachable from `to`?
  const stack = [to]
  const visited = new Set<string>()
  while (stack.length) {
    const n = stack.pop()!
    if (n === from) return true
    if (visited.has(n)) continue
    visited.add(n)
    for (const next of adj.get(n) ?? []) stack.push(next)
  }
  return false
}

export function isDirectedType(type: string): boolean {
  return (DIRECTED_TYPES as readonly string[]).includes(type)
}

