import { describe, it, expect } from 'vitest'
import { KLP_KINDS } from '@/lib/ai/schemas'
import { EXPECTED_SHAPE, type CardTopicProposal } from '@/lib/klp/topic-minting'
import {
  normalizeName,
  sameConceptByRule,
  isContainerName,
  reconcileProposals,
  applyVerdicts,
} from '@/lib/klp/topic-reconcile'
import { buildJudgeItems, toVerdicts, buildJudgePrompt } from '@/lib/klp/topic-judge'

const empty = (): CardTopicProposal => ({ parent: 'p', leaves: [], contexts: [], relations: [] })
const leaf = (name: string, ...klpRefs: number[]) => ({ name, klpRefs })
const edge = (klpRef: number, from: string, to: string, type: any = 'precedes') => ({ klpRef, from, to, type })
const ctx = (klpRef: number, concept: string) => ({ klpRef, concept })
const kinds = (...ks: string[]) => ks.map((kind) => ({ kind }))

describe('EXPECTED_SHAPE', () => {
  it('has an entry for every KLP kind — a missing kind would silently read as either', () => {
    for (const k of KLP_KINDS) expect(EXPECTED_SHAPE[k], k).toBeDefined()
  })
})

describe('normalizeName', () => {
  it('expands abbreviations, strips punctuation and one trailing noise word', () => {
    expect(normalizeName('EBIT')).toBe(normalizeName('earnings before interest and taxes'))
    expect(normalizeName('Gross Profit Calculation')).toBe(normalizeName('gross profit'))
    expect(normalizeName('accounting equation structure')).toBe(normalizeName('accounting equation'))
    expect(normalizeName('non-cash expense add-backs')).toBe(normalizeName('noncash expense addbacks'))
  })
  it('strips only ONE noise word, so a name that is all noise does not vanish', () => {
    expect(normalizeName('structure')).toBe('structure')
  })
})

describe('sameConceptByRule', () => {
  it('accepts an extension of the same noun phrase', () => {
    expect(sameConceptByRule('fundamental accounting equation', 'accounting equation')).toBe(true)
    expect(sameConceptByRule('balance sheet snapshot concept', 'balance sheet snapshot')).toBe(true)
  })
  it('REJECTS siblings that share a head noun — the Part E false merge', () => {
    expect(sameConceptByRule('effective tax rate', 'marginal tax rate')).toBe(false)
    expect(sameConceptByRule('non-cash expenses', 'non-deductible expenses')).toBe(false)
  })
  it('rejects a one-token name swallowed by a longer one', () => {
    expect(sameConceptByRule('assets', 'long-term assets')).toBe(false)
  })
})

describe('isContainerName', () => {
  it('matches a statement name with a word added, which the exact list missed', () => {
    expect(isContainerName('cash flow statement mechanics')).toBe(true)
    expect(isContainerName('balance sheet structure')).toBe(true)
    expect(isContainerName('operating cash flow')).toBe(false)
    expect(isContainerName('leverage')).toBe(true)
  })
})

describe('reconcileProposals — type priority (edge > context > leaf)', () => {
  it('an edge beats a leaf regardless of the kind prior; the kind conflict is a note', () => {
    const a = { ...empty(), leaves: [leaf('gross profit', 0)] }
    const b = { ...empty(), relations: [edge(0, 'revenue', 'gross profit', 'requires')] }
    const m = reconcileProposals({ klps: kinds('definition'), a, b })
    expect(m.relations).toHaveLength(1)
    expect(m.leaves).toHaveLength(0)
    expect(m.conflicts).toHaveLength(0)
    expect(m.notes.find((n) => n.includes('rule:edge-priority'))).toContain('kind_conflict')
  })

  it('keeps the larger count: A\'s leaf + context against B\'s edge yields edge + context', () => {
    const a = { ...empty(), leaves: [leaf('investing cash flow', 0)], contexts: [ctx(0, 'capital expenditures')] }
    const b = { ...empty(), relations: [edge(0, 'capital expenditures', 'investing cash flow', 'applies_within')] }
    const m = reconcileProposals({ klps: kinds('mechanism'), a, b, runVocabulary: new Set([normalizeName('capital expenditures')]) })
    expect(m.relations).toHaveLength(1)
    expect(m.leaves).toHaveLength(0)
    expect(m.contexts.map((c) => c.concept)).toEqual(['capital expenditures'])
  })

  it('a definition KLP may keep the statement leaf beside its mechanism edge (rule 3 exception)', () => {
    const a = { ...empty(), leaves: [leaf('income statement', 0)], relations: [edge(0, 'revenue', 'net income')] }
    const b = { ...empty(), leaves: [leaf('income statement', 0)] }
    const m = reconcileProposals({ klps: kinds('definition'), a, b })
    expect(m.leaves[0]).toMatchObject({ name: 'income statement', container: true, containerAllowed: true })
    expect(m.relations).toHaveLength(1)
  })

  it('takes the only model that covered a KLP', () => {
    const a = { ...empty(), leaves: [leaf('goodwill', 0)] }
    const m = reconcileProposals({ klps: kinds('definition'), a, b: empty() })
    expect(m.leaves[0]).toMatchObject({ name: 'goodwill', reason: 'rule:only-coverage' })
  })
})

describe('reconcileProposals — names and the overly-broad check', () => {
  it('same concept: the shorter original wins, tie goes to B (Gemini)', () => {
    const a = { ...empty(), leaves: [leaf('accounting equation', 0), leaf('balance sheet snapshot', 1)] }
    const b = { ...empty(), leaves: [leaf('fundamental accounting equation', 0), leaf('balance sheet snapshot concept', 1)] }
    const m = reconcileProposals({ klps: kinds('quantitative', 'definition'), a, b })
    expect(m.leaves.map((l) => l.name)).toEqual(['accounting equation', 'balance sheet snapshot'])
    expect(m.leaves[0].reason).toBe('rule:shorter')
    const tie = reconcileProposals({
      klps: kinds('definition'),
      a: { ...empty(), leaves: [leaf('net income figure', 0)] },
      b: { ...empty(), leaves: [leaf('net income calculation', 0)] },
    })
    expect(tie.leaves[0]).toMatchObject({ name: 'net income calculation', reason: 'rule:tie-gemini' })
  })

  it('a container name loses to a non-container without a call — on either side', () => {
    const m1 = reconcileProposals({
      klps: kinds('mechanism'),
      a: { ...empty(), leaves: [leaf('cash flow statement adjustments', 0)] },
      b: { ...empty(), leaves: [leaf('net change in cash', 0)] },
    })
    expect(m1.leaves[0]).toMatchObject({ name: 'net change in cash', reason: 'rule:avoid-container', source: 'b' })
    const m2 = reconcileProposals({
      klps: kinds('mechanism'),
      a: { ...empty(), leaves: [leaf('working capital changes', 0)] },
      b: { ...empty(), leaves: [leaf('balance sheet items', 0)] },
    })
    expect(m2.leaves[0]).toMatchObject({ name: 'working capital changes', reason: 'rule:avoid-container', source: 'a' })
    expect(m1.conflicts).toHaveLength(0)
  })

  it('…but on a definition KLP the statement IS the subject, and wins over the noun mentioned', () => {
    const m = reconcileProposals({
      klps: kinds('definition'),
      a: { ...empty(), leaves: [leaf('income statement', 0)] },
      b: { ...empty(), leaves: [leaf('net income', 0)] },
    })
    expect(m.leaves[0]).toMatchObject({ name: 'income statement', reason: 'rule:statement-definition', container: true, containerAllowed: true })
    expect(m.conflicts).toHaveLength(0)
  })

  it('different, non-container names go to the judge', () => {
    const m = reconcileProposals({
      klps: kinds('mechanism'),
      a: { ...empty(), leaves: [leaf('depreciation', 0)] },
      b: { ...empty(), leaves: [leaf('non-cash expense add-backs', 0)] },
    })
    expect(m.conflicts).toEqual([expect.objectContaining({ klpRef: 0, kind: 'name_conflict' })])
  })

  it('re-groups KLPs whose merged names coincide into one leaf', () => {
    const a = { ...empty(), leaves: [leaf('equity', 0), leaf('equity', 1)] }
    const b = { ...empty(), leaves: [leaf('equity', 0), leaf('equity concept', 1)] }
    const m = reconcileProposals({ klps: kinds('definition', 'definition'), a, b })
    expect(m.leaves).toHaveLength(1)
    expect(m.leaves[0].klpRefs).toEqual([0, 1])
  })
})

describe('reconcileProposals — edges', () => {
  it('same endpoints, different type: Gemini\'s type', () => {
    const a = { ...empty(), relations: [edge(0, 'ebit', 'ebitda', 'causes')] }
    const b = { ...empty(), relations: [edge(0, 'earnings before interest and taxes', 'earnings before interest taxes depreciation and amortization', 'precedes')] }
    const m = reconcileProposals({ klps: kinds('causal'), a, b })
    expect(m.relations[0]).toMatchObject({ type: 'precedes', reason: 'rule:type-gemini' })
  })

  it('a container endpoint loses to a specific one without a call', () => {
    const a = { ...empty(), relations: [edge(0, 'net income', 'cash flow statement')] }
    const b = { ...empty(), relations: [edge(0, 'net income', 'operating cash flow')] }
    const m = reconcileProposals({ klps: kinds('causal'), a, b })
    expect(m.relations).toHaveLength(1)
    expect(m.relations[0]).toMatchObject({ to: 'operating cash flow', reason: 'rule:avoid-container-endpoint' })
  })

  it('nothing A adds is dropped: A\'s two edges against B\'s one go to alignment, not replacement', () => {
    const a = { ...empty(), relations: [edge(0, 'liabilities', 'assets', 'causes'), edge(0, 'equity', 'assets', 'causes')] }
    const b = { ...empty(), relations: [edge(0, 'capital structure', 'assets', 'causes')] }
    const m = reconcileProposals({ klps: kinds('causal'), a, b })
    expect(m.conflicts[0]).toMatchObject({ kind: 'edge_align' })
    expect(m.conflicts[0].aEdges).toHaveLength(2)
  })

  it('A-only extra edges are kept as extras when B has none unmatched', () => {
    const a = { ...empty(), relations: [edge(0, 'x', 'y'), edge(0, 'y', 'z')] }
    const b = { ...empty(), relations: [edge(0, 'x', 'y')] }
    const m = reconcileProposals({ klps: kinds('causal'), a, b })
    expect(m.relations.map((e) => e.reason).sort()).toEqual(['rule:ds-extra-edge', 'rule:edge-both'])
  })
})

describe('reconcileProposals — contexts', () => {
  it('both → kept; Gemini-only → kept; A-only in vocabulary → kept; A-only novel → judge; container → dropped', () => {
    const a = {
      ...empty(),
      leaves: [leaf('assets', 0), leaf('liabilities', 1), leaf('equity', 2)],
      contexts: [ctx(0, 'future economic benefits'), ctx(1, 'liability settlement'), ctx(2, 'equity rollforward'), ctx(0, 'balance sheet')],
    }
    const b = {
      ...empty(),
      leaves: [leaf('assets', 0), leaf('liabilities', 1), leaf('equity', 2)],
      contexts: [ctx(2, 'equity rollforward'), ctx(1, 'external claims')],
    }
    const m = reconcileProposals({ klps: kinds('definition', 'definition', 'definition'), a, b, runVocabulary: new Set([normalizeName('liability settlement')]) })
    expect(m.contexts.map((c) => c.concept).sort()).toEqual(['equity rollforward', 'external claims', 'liability settlement'])
    expect(m.conflicts).toEqual([expect.objectContaining({ kind: 'extra_context', concept: 'future economic benefits' })])
    expect(m.notes.some((n) => n.includes('drop:container-context'))).toBe(true)
  })

  it('a self-duplicating context is purged', () => {
    const a = { ...empty(), leaves: [leaf('investing cash flow', 0)], contexts: [ctx(0, 'investing cash flow')] }
    const m = reconcileProposals({ klps: kinds('definition'), a, b: { ...empty(), leaves: [leaf('investing cash flow', 0)] } })
    expect(m.contexts).toHaveLength(0)
    expect(m.notes.some((n) => n.includes('purge:self-dup'))).toBe(true)
  })
})

describe('applyVerdicts', () => {
  const nameCase = () =>
    reconcileProposals({
      klps: kinds('mechanism'),
      a: { ...empty(), leaves: [leaf('depreciation', 0)] },
      b: { ...empty(), leaves: [leaf('non-cash expense add-backs', 0)] },
    })
  it('sameConcept: the rule (shorter) decides, not the judge', () => {
    const m = applyVerdicts(nameCase(), [{ klpRef: 0, conflictIndex: 0, sameConcept: true }])
    expect(m.leaves[0]).toMatchObject({ name: 'depreciation', reason: 'judge:same-concept→shorter' })
  })
  it('DeepSeek wins a name when preferred AND (Gemini\'s is not acceptable OR its own name is shorter)', () => {
    // nameCase: A "depreciation" (1 word) vs B "non-cash expense add-backs" (3 words) — A is shorter.
    const soft = applyVerdicts(nameCase(), [{ klpRef: 0, conflictIndex: 0, sameConcept: false, prefer: 'a', otherAcceptable: true }])
    expect(soft.leaves[0]).toMatchObject({ name: 'depreciation', reason: 'judge:ds-preferred+shorter' })
    const hard = applyVerdicts(nameCase(), [{ klpRef: 0, conflictIndex: 0, sameConcept: false, prefer: 'a', otherAcceptable: false }])
    expect(hard.leaves[0]).toMatchObject({ name: 'depreciation', reason: 'judge:ds-clear' })
    // Preferred but LONGER and acceptable either way: Gemini keeps it.
    const longer = reconcileProposals({
      klps: kinds('mechanism'),
      a: { ...empty(), leaves: [leaf('deferred revenue carryover treatment', 0)] },
      b: { ...empty(), leaves: [leaf('purchase accounting', 0)] },
    })
    expect(longer.conflicts).toHaveLength(1)
    const kept = applyVerdicts(longer, [{ klpRef: 0, conflictIndex: 0, sameConcept: false, prefer: 'a', otherAcceptable: true }])
    expect(kept.leaves[0]).toMatchObject({ name: 'purchase accounting', reason: 'judge:gemini-weighted' })
  })
  it('a missing name verdict falls back to Gemini and is noted', () => {
    const m = applyVerdicts(nameCase(), [])
    expect(m.leaves[0]).toMatchObject({ name: 'non-cash expense add-backs', reason: 'fallback:gemini' })
    expect(m.notes.some((n) => n.includes('fallback'))).toBe(true)
  })

  it('edge alignment: B replaces the A edge it matches; every other edge survives', () => {
    const m0 = reconcileProposals({
      klps: kinds('causal'),
      a: { ...empty(), relations: [edge(0, 'liabilities', 'assets', 'causes'), edge(0, 'equity', 'assets', 'causes')] },
      b: { ...empty(), relations: [edge(0, 'liabilities and equity', 'assets', 'requires')] },
    })
    const m = applyVerdicts(m0, [{ klpRef: 0, conflictIndex: 0, sameLinks: [{ a: 0, b: 0 }] }])
    expect(m.relations).toHaveLength(2)
    expect(m.relations.find((e) => e.from === 'liabilities and equity')).toMatchObject({ type: 'requires', reason: 'judge:same-link→gemini' })
    expect(m.relations.find((e) => e.from === 'equity')).toMatchObject({ reason: 'judge:distinct-extra' })
    const none = applyVerdicts(m0, [])
    expect(none.relations).toHaveLength(3)
    expect(none.relations.every((e) => e.reason === 'fallback:keep-both')).toBe(true)
  })

  it('an A-only extra context is kept unless the judge says it restates; missing verdict keeps it', () => {
    const base = () =>
      reconcileProposals({
        klps: kinds('definition'),
        a: { ...empty(), leaves: [leaf('assets', 0)], contexts: [ctx(0, 'future economic benefits')] },
        b: { ...empty(), leaves: [leaf('assets', 0)] },
      })
    expect(applyVerdicts(base(), [{ klpRef: 0, conflictIndex: 0, distinct: true }]).contexts[0]).toMatchObject({ reason: 'judge:extra-kept' })
    expect(applyVerdicts(base(), [{ klpRef: 0, conflictIndex: 0, distinct: false }]).contexts).toHaveLength(0)
    expect(applyVerdicts(base(), []).contexts[0]).toMatchObject({ reason: 'fallback:keep-extra' })
  })
})

describe('topic-judge side mapping', () => {
  it('maps A/B answers — and edge index pairs — back to the reconciler side they were shown under', () => {
    const conflicts = Array.from({ length: 8 }, (_, i) => ({
      klpRef: i,
      conflictIndex: i,
      kind: 'name_conflict' as const,
      klpKind: 'definition',
      aName: `ds-${i}`,
      bName: `gem-${i}`,
    }))
    const items = buildJudgeItems(conflicts, conflicts.map((c) => `text ${c.klpRef}`), 7)
    expect(new Set(items.map((i) => i.aIs)).size).toBe(2)
    const prompt = buildJudgePrompt(items)
    for (const it of items) expect(prompt).toContain(`A: leaf "${it.aIs === 'a' ? `ds-${it.index}` : `gem-${it.index}`}"`)
    const verdicts = toVerdicts(items, { verdicts: items.map((it) => ({ item: it.index, sameConcept: false, prefer: 'A' as const, otherAcceptable: false })) })
    for (const it of items) expect(verdicts.find((v) => v.klpRef === it.conflict.klpRef)?.prefer).toBe(it.aIs)

    const e = { klpRef: 0, conflictIndex: 0, kind: 'edge_align' as const, klpKind: 'causal', aEdges: [edge(0, 'x', 'y'), edge(0, 'p', 'q')], bEdges: [edge(0, 'p2', 'q2')] }
    for (const seed of [1, 2, 3, 4]) {
      const [item] = buildJudgeItems([e], ['t'], seed)
      // The judge says "shown-A index 1 equals shown-B index 0" when reconciler-a is shown as A,
      // or "shown-A index 0 equals shown-B index 1" when the sides are swapped.
      const shown = item.aIs === 'a' ? { a: 1, b: 0 } : { a: 0, b: 1 }
      const [v] = toVerdicts([item], { verdicts: [{ item: 0, sameLinks: [shown] }] })
      expect(v.sameLinks).toEqual([{ a: 1, b: 0 }])
    }
  })
})

describe('reconcileProposals — agreement beats priority', () => {
  it('when BOTH models emit a leaf and an edge for one KLP, both are kept', () => {
    const a = { ...empty(), leaves: [leaf('stock purchase', 0)], relations: [edge(0, 'stock purchase', 'asset purchase', 'confused_with')] }
    const b = { ...empty(), leaves: [leaf('stock purchase', 0)], relations: [edge(0, 'stock purchase', 'asset purchase', 'confused_with')] }
    const m = reconcileProposals({ klps: kinds('contrast'), a, b })
    expect(m.leaves.map((l) => l.name)).toEqual(['stock purchase'])
    expect(m.relations).toHaveLength(1)
  })
})

describe('reconcileProposals — larger count with mixed types', () => {
  it('A leaf+edge vs B leaf-only: B\'s leaf replaces A\'s (same type), A\'s edge is kept as the extra', () => {
    const a = { ...empty(), leaves: [leaf('stock purchase', 0)], relations: [edge(0, 'stock purchase', 'asset purchase', 'confused_with')] }
    const b = { ...empty(), leaves: [leaf('stock purchase', 0)] }
    const m = reconcileProposals({ klps: kinds('contrast'), a, b })
    expect(m.leaves.map((l) => l.name)).toEqual(['stock purchase'])
    expect(m.relations).toHaveLength(1)
    expect(m.relations[0].reason).toBe('rule:ds-extra-edge')
  })
  it('a pure split (A only-leaf, B only-edge) still drops the leaf', () => {
    const a = { ...empty(), leaves: [leaf('net income as cash flow starting point', 0)] }
    const b = { ...empty(), relations: [edge(0, 'net income', 'operating cash flow')] }
    const m = reconcileProposals({ klps: kinds('causal'), a, b })
    expect(m.leaves).toHaveLength(0)
    expect(m.relations).toHaveLength(1)
  })
})
