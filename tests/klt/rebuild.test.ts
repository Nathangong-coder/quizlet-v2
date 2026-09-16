import { describe, it, expect } from 'vitest'
import { rebuildTree, renderTree, applyMerges, stripFacet, PROMOTE_CARDS, type CardFragment } from '@/lib/klt/rebuild'

const frag = (cardId: string, anchor: string, leaves: [string, string][], rels: [string, string, string][] = [], contexts: string[] = [], mode?: CardFragment['mode']): CardFragment => ({
  cardId, term: cardId, anchor, domain: 'mergers and acquisitions',
  leaves: [{ name: anchor, klpRefs: [0], under: anchor }, ...leaves.map(([name, under], i) => ({ name, klpRefs: [i + 1], under }))],
  contexts: contexts.map((c, i) => ({ klpRef: i, concept: c })),
  relations: rels.map(([from, to, type], i) => ({ klpRef: i, from, to, type })),
  ...(mode ? { mode } : {}),
})
const dom = (plan: ReturnType<typeof rebuildTree>) => plan.nodes.find((n) => n.role === 'domain')!.key
const node = (plan: ReturnType<typeof rebuildTree>, key: string) => plan.nodes.find((n) => n.key === key)

describe('rebuildTree', () => {
  it('brings an existing vocabulary topic into the plan when an anchor is placed under it', () => {
    const vocab = [{ kltId: 'k-cod', name: 'cost of debt', normalizedName: 'cost of debt', status: 'active', aliases: [] as string[] }]
    const plan = rebuildTree('s', [frag('c1', 'breakeven cost of debt', [])], vocab)
    const cod = node(plan, 'cost of debt')!
    expect(cod.matched?.kltId).toBe('k-cod')
    expect(cod.status).toBe('active')
    expect(cod.parent).toBe(dom(plan))
    expect(node(plan, 'breakeven cost of debt')!.parent).toBe('cost of debt')
    expect(plan.anchorMatches).toEqual({ placed: 1 })
  })

  it('a stored plural name is the same key as its singular proposal', () => {
    const vocab = [{ kltId: 'k-eps', name: 'earnings per share', normalizedName: 'earnings per share', status: 'active', aliases: [] as string[] }]
    const plan = rebuildTree('s', [frag('c1', 'earnings per share', [['EPS dilution', 'earnings per share']])], vocab)
    const eps = plan.nodes.find((n) => n.matched?.kltId === 'k-eps')!
    expect(eps.role).toBe('anchor')
    expect(plan.nodes.filter((n) => n.name.toLowerCase().startsWith('earnings per share'))).toHaveLength(1)
  })

  it('shares an anchor across cards, and a leaf two cards name becomes a node under the heavier parent, cross-listed under the other', () => {
    const plan = rebuildTree('s', [
      frag('c1', 'deferred revenue', [['fair value write-down', 'deferred revenue']]),
      frag('c2', 'Deferred Revenue', [['fair value write-down', 'deferred revenue']]),
      frag('c3', 'goodwill', [['fair value write-down', 'goodwill']]),
    ], [])
    const dr = node(plan, 'deferred revenue')!
    expect(dr.role).toBe('anchor')
    expect(dr.cards).toEqual(['c1', 'c2'])
    const fv = plan.nodes.find((n) => n.name === 'fair value write-down')!
    expect(fv.role).toBe('leaf')
    expect(fv.parent).toBe('deferred revenue')
    expect(fv.alsoUnder).toEqual(['goodwill'])
    expect(plan.anchorMatches).toEqual({ new: 2, exact: 1 })
  })

  it('THE NODE BAR: a single-card leaf with one point is a label, not a node; its parent is the nearest real node', () => {
    const plan = rebuildTree('s', [frag('c1', 'divestiture', [['carve-out of division', 'divestiture'], ['discontinued operations presentation', 'carve-out of division']])], [])
    const carve = plan.nodes.find((n) => n.name === 'carve-out of division')!
    expect(carve.role).toBe('label')
    expect(carve.parent).toBe('divestiture')
    const disc = plan.nodes.find((n) => n.name === 'discontinued operations presentation')!
    expect(disc.role).toBe('label')
    expect(disc.parent).toBe('divestiture')
    expect(renderTree(plan)).toContain('2 labels')
    expect(renderTree(plan)).not.toContain('carve-out')
  })

  it('a leaf with three points clears the bar on one card', () => {
    const f = frag('c1', 'goodwill', [['impairment testing', 'goodwill']])
    f.leaves[1].klpRefs = [1, 2, 3]
    const plan = rebuildTree('s', [f], [])
    expect(plan.nodes.find((n) => n.name === 'impairment testing')!.role).toBe('leaf')
  })

  it('CONTEXTS POINT UP: a context that matches another card\'s anchor cross-lists this anchor under it', () => {
    const plan = rebuildTree('s', [
      frag('c1', 'divestiture', [['sale proceeds', 'divestiture']], [], ['sources and uses schedule']),
      frag('c2', 'sources and uses schedule', [['sources equal uses', 'sources and uses schedule']]),
    ], [])
    const div = node(plan, 'divestiture')!
    expect(div.parent).toBe(dom(plan))
    expect(div.alsoUnder).toEqual(['source and use schedule'])
    const su = node(plan, 'source and use schedule')!
    expect(su.parent).toBe(dom(plan))
    expect(su.cards).toEqual(['c2', 'c1'])
  })

  it('EDGE ENDPOINTS NEVER MINT NODES: an endpoint that is nothing drops the edge; one that is a label rolls to its parent', () => {
    const plan = rebuildTree('s', [
      frag('c1', 'earnings yield', [['yield comparison', 'earnings yield']], [['yield comparison', 'pro forma eps', 'causes'], ['earnings yield', 'nothing here at all', 'causes']]),
      frag('c2', 'accretion/dilution', [['pro forma eps', 'accretion/dilution']]),
      frag('c3', 'merger model', [['pro forma eps', 'merger model']]),
    ], [])
    expect(plan.nodes.find((n) => n.name === 'nothing here at all')).toBeUndefined()
    expect(plan.droppedEdges).toBe(1)
    const pfe = plan.nodes.find((n) => n.name === 'pro forma eps')!
    expect(pfe.role).toBe('leaf')
    // "yield comparison" is a label under earnings yield, so the edge rolls to earnings yield → pro forma eps
    const r = plan.rolledEdges.find((e) => e.to === pfe.key)!
    expect(r.from).toBe('earning yield')
    expect(plan.edges).toHaveLength(0)
  })

  it('WEIGHTED VOTES: ties go to the parent with more cards, not the earlier one', () => {
    const plan = rebuildTree('s', [
      frag('c1', 'recasting', [['pro forma eps', 'recasting']]),
      frag('c2', 'accretion/dilution', [['pro forma eps', 'accretion/dilution']]),
      frag('c3', 'accretion/dilution', [['standalone eps', 'accretion/dilution']]),
    ], [])
    expect(plan.nodes.find((n) => n.name === 'pro forma eps')!.parent).toBe('accretion dilution')
  })

  it('APPLIED cards mint one skill node; their specifics are labels and general concepts get a rank-2 link', () => {
    const plan = rebuildTree('s', [
      frag('c1', 'buyer type', [['strategic buyers', 'buyer type'], ['financial buyers', 'buyer type']]),
      frag('c2', 'company sale positioning', [['us manufacturing base', 'company sale positioning'], ['strategic buyers', 'company sale positioning']], [], [], 'applied'),
    ], [])
    const skill = node(plan, 'company sale positioning')!
    expect(skill.role).toBe('anchor')
    expect(skill.nature).toBe('skill')
    const usm = plan.nodes.find((n) => n.name === 'us manufacturing base')!
    expect(usm.role).toBe('label')
    expect(usm.parent).toBe('company sale positioning')
    expect(plan.generalLinks).toEqual([{ cardId: 'c2', klpRefs: [2], key: 'strategic buyer' }])
    expect(node(plan, 'strategic buyer')!.cards).toEqual(['c1', 'c2'])
    expect(plan.modes).toEqual({ knowledge: 1, applied: 1 })
  })

  it('CONSOLIDATION by facet suffix, and judge candidates for containment between real nodes', () => {
    expect(stripFacet('accretion dilution analysis')).toBe('accretion dilution')
    expect(stripFacet('debt schedule')).toBe('debt')
    expect(stripFacet('goodwill')).toBeNull()
    const plan = rebuildTree('s', [
      frag('c1', 'accretion/dilution', [['pro forma eps', 'accretion/dilution']]),
      frag('c2', 'accretion/dilution analysis', [['pro forma eps', 'accretion/dilution analysis']]),
      frag('c3', 'eps accretion', [['new eps', 'eps accretion']]),
      frag('c4', 'eps accretion', [['new eps', 'eps accretion']]),
    ], [])
    const alias = node(plan, 'accretion dilution analysis')!
    expect(alias.role).toBe('alias')
    expect(alias.mergedInto).toBe('accretion dilution')
    expect(node(plan, 'accretion dilution')!.cards).toEqual(['c1', 'c2'])
    expect(plan.merges).toEqual([{ from: 'accretion dilution analysis', into: 'accretion dilution', rule: 'facet' }])
    expect(renderTree(plan)).toContain('= accretion/dilution analysis')
    // "eps accretion" ⊃ "accretion" tokens? no — but "eps accretion" is not contained by "accretion dilution"; check a real containment pair
    const plan2 = rebuildTree('s', [
      frag('c1', 'deferred revenue', [['x', 'deferred revenue'], ['y', 'deferred revenue']]),
      frag('c2', 'acquired deferred revenue', [['x', 'acquired deferred revenue'], ['y', 'acquired deferred revenue']]),
    ], [])
    // containment already placed the specific anchor under the general, so it is NOT a judge candidate
    expect(node(plan2, 'acquired deferred revenue')!.parent).toBe('deferred revenue')
    expect(plan2.judgeCandidates).toEqual([])
  })

  it('applyMerges folds a judged pair into the survivor and rewires parents and edges', () => {
    // the specific anchor is seen BEFORE the general one exists, so containment cannot place it: both sit under the domain → a judge candidate
    const plan = rebuildTree('s', [
      frag('c3', 'equity purchase price', [['sponsor equity', 'equity purchase price']]),
      frag('c4', 'equity purchase price', [['sponsor equity', 'equity purchase price']]),
      frag('c1', 'purchase price', [['financing mix', 'purchase price']]),
      frag('c2', 'purchase price', [['financing mix', 'purchase price']]),
    ], [])
    expect(plan.judgeCandidates).toContainEqual({ specific: 'equity purchase price', general: 'purchase price' })
    applyMerges(plan, [{ specific: 'equity purchase price', general: 'purchase price', verdict: 'same' }])
    expect(node(plan, 'equity purchase price')!.role).toBe('alias')
    expect(node(plan, 'purchase price')!.cards.sort()).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(plan.nodes.find((n) => n.name === 'sponsor equity')!.parent).toBe('purchase price')
  })

  it('recurrence promotes, and clusters anchors that share a child', () => {
    const fragments: CardFragment[] = ['c1', 'c2', 'c3', 'c4'].map((c) => frag(c, 'deferred revenue', [['fair value write-down', 'deferred revenue']]))
    const plan = rebuildTree('s', fragments, [])
    const dr = node(plan, 'deferred revenue')!
    expect(dr.cards.length).toBeGreaterThanOrEqual(PROMOTE_CARDS)
    expect(dr.status).toBe('active')
    const plan2 = rebuildTree('s', [
      frag('c1', 'stock consideration', [['dilution', 'stock consideration']]),
      frag('c2', 'cash consideration', [['dilution', 'cash consideration']]),
      frag('c3', 'debt consideration', [['dilution', 'debt consideration']]),
      frag('c4', 'goodwill', [['impairment', 'goodwill']]),
    ], [])
    expect(plan2.clusters).toHaveLength(1)
    expect(plan2.clusters[0].members.sort()).toEqual(['cash consideration', 'debt consideration', 'stock consideration'])
    expect(plan2.clusters[0].wantsParent).toBe(true)
  })

  it('never loops on a parent cycle', () => {
    const plan = rebuildTree('s', [
      frag('c1', 'a', [['b', 'a']]),
      frag('c2', 'b', [['a', 'b']]),
    ], [])
    expect(renderTree(plan).split('\n').length).toBeLessThan(20)
  })
})
