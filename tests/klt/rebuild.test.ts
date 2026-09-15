import { describe, it, expect } from 'vitest'
import { rebuildTree, renderTree, PROMOTE_CARDS, type CardFragment } from '@/lib/klt/rebuild'

const frag = (cardId: string, anchor: string, leaves: [string, string][], rels: [string, string, string][] = [], contexts: string[] = []): CardFragment => ({
  cardId, term: cardId, anchor, domain: 'mergers and acquisitions',
  leaves: [{ name: anchor, klpRefs: [0], under: anchor }, ...leaves.map(([name, under], i) => ({ name, klpRefs: [i + 1], under }))],
  contexts: contexts.map((c, i) => ({ klpRef: i, concept: c })),
  relations: rels.map(([from, to, type], i) => ({ klpRef: i, from, to, type })),
})

describe('rebuildTree', () => {
  it('brings an existing vocabulary topic into the plan when a node is placed under it (2026-09-15: "breakeven cost of debt" under a "cost of debt" no card named)', () => {
    const vocab = [{ kltId: 'k-cod', name: 'cost of debt', normalizedName: 'cost of debt', status: 'active', aliases: [] as string[] }]
    const plan = rebuildTree('s', [frag('c1', 'breakeven cost of debt', [])], vocab)
    const cod = plan.nodes.find((n) => n.key === 'cost of debt')!
    expect(cod).toBeDefined()
    expect(cod.matched?.kltId).toBe('k-cod')
    expect(cod.status).toBe('active')
    expect(cod.parent).toBe(plan.nodes.find((n) => n.role === 'domain')!.key)
    expect(plan.nodes.find((n) => n.key === 'breakeven cost of debt')!.parent).toBe('cost of debt')
    expect(plan.anchorMatches).toEqual({ placed: 1 })
  })

  it('a stored plural name is the same key as its singular proposal (matcher normalises both sides)', () => {
    const vocab = [{ kltId: 'k-eps', name: 'earnings per share', normalizedName: 'earnings per share', status: 'active', aliases: [] as string[] }]
    const plan = rebuildTree('s', [frag('c1', 'earnings per share', [['EPS dilution', 'earnings per share']])], vocab)
    const eps = plan.nodes.find((n) => n.matched?.kltId === 'k-eps')!
    expect(eps.role).toBe('anchor')
    expect(eps.parent).toBe(plan.nodes.find((n) => n.role === 'domain')!.key)
    expect(plan.nodes.filter((n) => n.name.toLowerCase().startsWith('earnings per share'))).toHaveLength(1)
  })

  it('shares an anchor across cards by the matcher, votes children under parents, and cross-lists a second parent', () => {
    const plan = rebuildTree('s', [
      frag('c1', 'deferred revenue', [['historical deferred revenue treatment', 'deferred revenue'], ['fair value write-down', 'historical deferred revenue treatment']]),
      frag('c2', 'Deferred Revenue', [['fair value write-down', 'deferred revenue']]),
      frag('c3', 'goodwill', [['fair value write-down', 'goodwill']]),
    ], [])
    const dr = plan.nodes.find((n) => n.key === 'deferred revenue')!
    expect(dr.role).toBe('anchor')
    expect(dr.cards).toEqual(['c1', 'c2'])
    expect(dr.parent).toBe(plan.nodes.find((n) => n.role === 'domain')!.key)
    const fv = plan.nodes.find((n) => n.key === 'fair value write down' || n.key === 'fair value writedown')!
    expect(fv).toBeDefined()
    // voted under three parents: the treatment (c1), deferred revenue (c2), goodwill (c3) — a tie on 1 each keeps the first seen, cross-lists the rest
    expect(Object.keys(fv.votes)).toHaveLength(3)
    expect(fv.alsoUnder).toHaveLength(2)
    expect(plan.anchorMatches).toEqual({ new: 2, exact: 1 })
  })

  it('a containment anchor is placed under the general one, edge endpoints are placed by proximity, and recurrence promotes', () => {
    const fragments: CardFragment[] = [
      frag('c1', 'deferred revenue', [], [['fair value write-down', 'post-close revenue', 'causes']]),
      frag('c2', 'acquired deferred revenue', [], [['fair value write-down', 'goodwill', 'causes']]),
      frag('c3', 'deferred revenue', [['fair value write-down', 'deferred revenue']]),
      frag('c4', 'deferred revenue', [['fair value write-down', 'deferred revenue']]),
      frag('c5', 'deferred revenue', []),
    ]
    const plan = rebuildTree('s', fragments, [])
    const adr = plan.nodes.find((n) => n.key === 'acquired deferred revenue')!
    expect(adr.parent).toBe('deferred revenue')
    const pcr = plan.nodes.find((n) => n.key === 'post close revenue' || n.key === 'postclose revenue')!
    expect(pcr.role).toBe('endpoint')
    expect(pcr.parent).toBe('deferred revenue')
    const dr = plan.nodes.find((n) => n.key === 'deferred revenue')!
    expect(dr.cards.length).toBeGreaterThanOrEqual(PROMOTE_CARDS)
    expect(dr.status).toBe('active')
    expect(plan.edges.find((e) => e.type === 'causes' && e.to.startsWith('goodwill'))?.cards).toEqual(['c2'])
    expect(renderTree(plan)).toContain('deferred revenue')
  })

  it('clusters anchors that share a child, and wants a parent at three or more', () => {
    const plan = rebuildTree('s', [
      frag('c1', 'stock consideration', [['dilution', 'stock consideration']]),
      frag('c2', 'cash consideration', [['dilution', 'cash consideration']]),
      frag('c3', 'debt consideration', [['dilution', 'debt consideration']]),
      frag('c4', 'goodwill', [['impairment', 'goodwill']]),
    ], [])
    expect(plan.clusters).toHaveLength(1)
    expect(plan.clusters[0].members.sort()).toEqual(['cash consideration', 'debt consideration', 'stock consideration'])
    expect(plan.clusters[0].sharedChildren).toEqual(['dilution'])
    expect(plan.clusters[0].wantsParent).toBe(true)
  })

  it('never loops on a parent cycle', () => {
    const plan = rebuildTree('s', [
      frag('c1', 'a', [['b', 'a']]),
      frag('c2', 'b', [['a', 'b']]),
    ], [])
    expect(renderTree(plan).split('\n').length).toBeLessThan(20)
  })
})
