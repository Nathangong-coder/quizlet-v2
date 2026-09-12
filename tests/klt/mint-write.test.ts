import { describe, it, expect } from 'vitest'
import { planMintWrites, wouldCycleRelations } from '@/lib/klt/mint-plan'
import type { MergedProposal } from '@/lib/klp/topic-reconcile'

const merged = (over: Partial<MergedProposal> = {}): MergedProposal => ({
  parent: 'financial statements',
  parentReason: 'rule:tie-gemini',
  leaves: [
    { name: 'income statement', klpRefs: [0], reason: 'rule:statement-definition', source: 'a', container: true, containerAllowed: true },
    { name: 'accounting equation', klpRefs: [5], reason: 'rule:shorter', source: 'a', container: false, containerAllowed: false },
  ],
  relations: [
    { klpRef: 6, from: 'net income', to: 'retained earnings', type: 'precedes', reason: 'rule:edge-both', source: 'both', containerEndpoint: false },
    { klpRef: 6, from: 'net income', to: 'retained earnings', type: 'precedes', reason: 'rule:edge-both', source: 'both', containerEndpoint: false },
  ],
  contexts: [
    { klpRef: 2, concept: 'non-cash adjustments', reason: 'rule:ctx-both', source: 'both' },
    { klpRef: 5, concept: 'Accounting Equation', reason: 'rule:ctx-gemini', source: 'b' },
  ],
  conflicts: [],
  notes: [],
  ...over,
})
const klpIds = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']

describe('planMintWrites', () => {
  it('upserts every name once, places parent then leaves/contexts under it, links rank 1 and rank 2, leaves endpoints unplaced', () => {
    const p = planMintWrites({ cardId: 'c1', klpIds, merged: merged(), existingSetNames: [] })
    expect(p.concepts.map((c) => `${c.role}:${c.normalizedName}`)).toEqual([
      'parent:financial statements',
      'leaf:income statement',
      'leaf:accounting equation',
      'context:non-cash adjustments',
      'endpoint:net income',
      'endpoint:retained earnings',
    ])
    expect(p.paths).toEqual([
      ['financial statements'],
      ['financial statements', 'income statement'],
      ['financial statements', 'accounting equation'],
      ['financial statements', 'non-cash adjustments'],
    ])
    expect(p.klpTopics).toEqual([
      { klpId: 'k0', normalizedName: 'income statement', rank: 1 },
      { klpId: 'k5', normalizedName: 'accounting equation', rank: 1 },
      { klpId: 'k2', normalizedName: 'non-cash adjustments', rank: 2 },
      // the context that duplicates KLP 5's own leaf is NOT linked twice
    ])
    expect(p.relations).toEqual([{ from: 'net income', to: 'retained earnings', type: 'precedes', klpIds: ['k6'] }])
    expect(p.unplaced).toEqual(['net income', 'retained earnings'])
  })

  it('reuses a same-set concept the minted name is the same as by rule, and reports it', () => {
    const p = planMintWrites({
      cardId: 'c1',
      klpIds,
      merged: merged({ leaves: [{ name: 'fundamental accounting equation', klpRefs: [5], reason: 'r', source: 'a', container: false, containerAllowed: false }], contexts: [], relations: [] }),
      existingSetNames: [{ name: 'accounting equation', normalizedName: 'accounting equation' }],
    })
    expect(p.concepts.find((c) => c.role === 'leaf')).toMatchObject({ name: 'accounting equation', reusedFrom: 'fundamental accounting equation' })
    expect(p.notes.some((n) => n.includes('reuses same-set concept'))).toBe(true)
  })

  it('does NOT reuse across a mere shared head noun, and skips a self-edge and an out-of-range KLP', () => {
    const p = planMintWrites({
      cardId: 'c1',
      klpIds: ['k0'],
      merged: merged({
        leaves: [{ name: 'effective tax rate', klpRefs: [0, 9], reason: 'r', source: 'a', container: false, containerAllowed: false }],
        contexts: [],
        relations: [{ klpRef: 0, from: 'assets', to: 'Assets', type: 'causes', reason: 'r', source: 'a', containerEndpoint: false }],
      }),
      existingSetNames: [{ name: 'marginal tax rate', normalizedName: 'marginal tax rate' }],
    })
    expect(p.concepts.find((c) => c.role === 'leaf')?.name).toBe('effective tax rate')
    expect(p.relations).toEqual([])
    expect(p.notes.some((n) => n.includes('self-edge'))).toBe(true)
    expect(p.notes.some((n) => n.includes('KLP 9'))).toBe(true)
  })
})

describe('wouldCycleRelations', () => {
  it('detects the two-card X->Y, Y->X case and longer cycles; allows a DAG', () => {
    expect(wouldCycleRelations([{ from: 'x', to: 'y' }], 'y', 'x')).toBe(true)
    expect(wouldCycleRelations([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], 'c', 'a')).toBe(true)
    expect(wouldCycleRelations([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], 'a', 'c')).toBe(false)
    expect(wouldCycleRelations([], 'a', 'a')).toBe(true)
  })
})

describe('name length', () => {
  it('contracts a spelled-out abbreviation that exceeds the concept-name cap instead of dropping it', () => {
    const p = planMintWrites({
      cardId: 'c1',
      klpIds: ['k0'],
      merged: merged({ leaves: [{ name: 'earnings before interest and taxes', klpRefs: [0], reason: 'r', source: 'a', container: false, containerAllowed: false }], contexts: [], relations: [] }),
      existingSetNames: [],
    })
    expect(p.concepts.find((c) => c.role === 'leaf')?.name).toBe('EBIT')
    expect(p.notes.some((n) => n.includes('written as "EBIT"'))).toBe(true)
  })
})
