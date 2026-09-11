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
    expect(isContainerName('cash flow statement sections')).toBe(true)
    expect(isContainerName('operating cash flow')).toBe(false)
    expect(isContainerName('leverage')).toBe(true)
  })
})

describe('reconcileProposals — shape', () => {
  it('edge wins a leaf/edge split when the kind prior allows an edge', () => {
    const a = { ...empty(), leaves: [leaf('net income as cash flow starting point', 0)] }
    const b = { ...empty(), relations: [edge(0, 'net income', 'operating cash flow')] }
    const m = reconcileProposals({ klps: kinds('causal'), a, b })
    expect(m.relations).toHaveLength(1)
    expect(m.relations[0].reason).toBe('rule:edge-wins-by-kind')
    expect(m.leaves).toHaveLength(0)
    expect(m.conflicts).toHaveLength(0)
  })

  it('routes a split to the judge when the kind prior says leaf', () => {
    const a = { ...empty(), leaves: [leaf('gross profit', 0)] }
    const b = { ...empty(), relations: [edge(0, 'revenue', 'gross profit', 'requires')] }
    const m = reconcileProposals({ klps: kinds('definition'), a, b })
    expect(m.conflicts).toEqual([expect.objectContaining({ klpRef: 0, kind: 'kind_conflict' })])
    expect(m.leaves).toHaveLength(0)
    expect(m.relations).toHaveLength(0)
  })

  it('a self-duplicating model loses its leaf to the other model\'s edge', () => {
    const a = {
      ...empty(),
      leaves: [leaf('investing cash flow', 0)],
      contexts: [ctx(0, 'investing cash flow')],
    }
    const b = { ...empty(), relations: [edge(0, 'capital expenditures', 'investing cash flow', 'applies_within')] }
    const m = reconcileProposals({ klps: kinds('definition'), a, b })
    expect(m.relations[0].reason).toBe('rule:edge-wins-self-dup')
    expect(m.contexts).toHaveLength(0)
    expect(m.notes.some((n) => n.includes('purge:self-dup'))).toBe(true)
  })

  it('takes the only model that covered a KLP', () => {
    const a = { ...empty(), leaves: [leaf('goodwill', 0)] }
    const m = reconcileProposals({ klps: kinds('definition'), a, b: empty() })
    expect(m.leaves[0]).toMatchObject({ name: 'goodwill', reason: 'rule:only-coverage' })
  })

  it('a model that emitted both a leaf and an edge for one KLP counts as edge', () => {
    const a = { ...empty(), leaves: [leaf('free cash flow', 0)], relations: [edge(0, 'operating cash flow', 'free cash flow', 'requires')] }
    const b = { ...empty(), relations: [edge(0, 'operating cash flow', 'free cash flow', 'requires')] }
    const m = reconcileProposals({ klps: kinds('quantitative'), a, b })
    expect(m.relations).toHaveLength(1)
    expect(m.leaves).toHaveLength(0)
  })
})

describe('reconcileProposals — names', () => {
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

  it('different names for the same KLP go to the judge', () => {
    const a = { ...empty(), leaves: [leaf('depreciation', 0)] }
    const b = { ...empty(), leaves: [leaf('non-cash expense add-backs', 0)] }
    const m = reconcileProposals({ klps: kinds('mechanism'), a, b })
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

describe('reconcileProposals — edges and contexts', () => {
  it('same endpoints, different type: Gemini\'s type', () => {
    const a = { ...empty(), relations: [edge(0, 'ebit', 'ebitda', 'causes')] }
    const b = { ...empty(), relations: [edge(0, 'earnings before interest and taxes', 'earnings before interest taxes depreciation and amortization', 'precedes')] }
    const m = reconcileProposals({ klps: kinds('causal'), a, b })
    expect(m.relations[0]).toMatchObject({ type: 'precedes', reason: 'rule:type-gemini' })
  })

  it('different endpoints go to the judge', () => {
    const a = { ...empty(), relations: [edge(0, 'net change in cash', 'cash and cash equivalents')] }
    const b = { ...empty(), relations: [edge(0, 'ending cash balance', 'current assets')] }
    const m = reconcileProposals({ klps: kinds('causal'), a, b })
    expect(m.conflicts[0].kind).toBe('edge_conflict')
  })

  it('keeps a context both produced or Gemini produced; drops a DeepSeek-only novel one; keeps a DeepSeek-only one in the run vocabulary', () => {
    const a = {
      ...empty(),
      leaves: [leaf('assets', 0), leaf('liabilities', 1), leaf('equity', 2)],
      contexts: [ctx(0, 'future economic benefits'), ctx(1, 'liability settlement'), ctx(2, 'equity rollforward')],
    }
    const b = {
      ...empty(),
      leaves: [leaf('assets', 0), leaf('liabilities', 1), leaf('equity', 2)],
      contexts: [ctx(2, 'equity rollforward'), ctx(1, 'external claims')],
    }
    const m = reconcileProposals({
      klps: kinds('definition', 'definition', 'definition'),
      a,
      b,
      runVocabulary: new Set([normalizeName('liability settlement')]),
    })
    const names = m.contexts.map((c) => c.concept).sort()
    expect(names).toEqual(['equity rollforward', 'external claims', 'liability settlement'])
    expect(m.contexts.find((c) => c.concept === 'liability settlement')?.reason).toBe('rule:ctx-in-vocab')
  })

  it('flags a container leaf by stem, on either side', () => {
    const a = { ...empty(), leaves: [leaf('cash flow statement mechanics', 0)] }
    const b = { ...empty(), leaves: [leaf('cash flow statement mechanics', 0)] }
    const m = reconcileProposals({ klps: kinds('mechanism'), a, b })
    expect(m.leaves[0].container).toBe(true)
  })
})

describe('applyVerdicts', () => {
  const base = () => {
    const a = { ...empty(), leaves: [leaf('depreciation', 0)] }
    const b = { ...empty(), leaves: [leaf('non-cash expense add-backs', 0)] }
    return reconcileProposals({ klps: kinds('mechanism'), a, b })
  }
  it('sameConcept: the rule (shorter) decides, not the judge', () => {
    const m = applyVerdicts(base(), [{ klpRef: 0, conflictIndex: 0, sameConcept: true }])
    expect(m.leaves[0]).toMatchObject({ name: 'depreciation', reason: 'judge:same-concept→shorter' })
  })
  it('DeepSeek wins only on a CLEAR preference; slight goes to Gemini', () => {
    const slight = applyVerdicts(base(), [{ klpRef: 0, conflictIndex: 0, sameConcept: false, prefer: 'a', strength: 'slight' }])
    expect(slight.leaves[0]).toMatchObject({ name: 'non-cash expense add-backs', reason: 'judge:gemini-weighted' })
    const clear = applyVerdicts(base(), [{ klpRef: 0, conflictIndex: 0, sameConcept: false, prefer: 'a', strength: 'clear' }])
    expect(clear.leaves[0]).toMatchObject({ name: 'depreciation', reason: 'judge:ds-clear' })
  })
  it('a missing verdict falls back to Gemini and is counted, never silent', () => {
    const m = applyVerdicts(base(), [])
    expect(m.leaves[0]).toMatchObject({ name: 'non-cash expense add-backs', reason: 'fallback:gemini' })
    expect(m.conflicts).toHaveLength(0)
    expect(m.notes.some((n) => n.includes('fallback'))).toBe(true)
  })
})

describe('topic-judge side mapping', () => {
  it('maps an A/B answer back to the reconciler side it was shown under', async () => {
    const { buildJudgeItems, toVerdicts, buildJudgePrompt } = await import('@/lib/klp/topic-judge')
    const conflicts = Array.from({ length: 8 }, (_, i) => ({
      klpRef: i,
      conflictIndex: i,
      kind: 'name_conflict' as const,
      klpKind: 'definition',
      a: { shape: 'leaf' as const, name: `ds-${i}` },
      b: { shape: 'leaf' as const, name: `gem-${i}` },
    }))
    const items = buildJudgeItems(conflicts, conflicts.map((c) => `text ${c.klpRef}`), 7)
    // Randomisation must actually vary — a constant assignment is a slot the judge can learn.
    expect(new Set(items.map((i) => i.aIs)).size).toBe(2)
    const prompt = buildJudgePrompt(items)
    for (const it of items) {
      const shownA = it.aIs === 'a' ? `ds-${it.index}` : `gem-${it.index}`
      expect(prompt).toContain(`A: LEAF "${shownA}"`)
    }
    const verdicts = toVerdicts(items, {
      verdicts: items.map((it) => ({ item: it.index, sameConcept: false, prefer: 'A' as const, strength: 'clear' as const })),
    })
    for (const it of items) {
      expect(verdicts.find((v) => v.klpRef === it.conflict.klpRef)?.prefer).toBe(it.aIs)
    }
  })
})
