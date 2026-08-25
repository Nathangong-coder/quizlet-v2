import { describe, it, expect } from 'vitest'
import { rollUpKltLinks, type KltNodeRow } from '@/lib/metrics/klt-rollup'

const link = (klpId: string) => ({
  rank: 1,
  klp: { id: klpId, supersededAt: null, cardId: `card-${klpId}` },
})

const node = (over: Partial<KltNodeRow> & { id: string }): KltNodeRow => ({
  normalizedName: over.id,
  name: over.id,
  depth: 0,
  ancestorIds: [],
  links: [],
  ...over,
})

describe('rollUpKltLinks', () => {
  it('folds a leaf’s own links into every ancestor named in ancestorIds', () => {
    // accounting (root) -> gaap (mid) -> revenue-recognition (leaf)
    const rows = [
      node({ id: 'root', ancestorIds: [] }),
      node({ id: 'mid', ancestorIds: ['root'] }),
      node({ id: 'leaf', ancestorIds: ['root', 'mid'], links: [link('a')] }),
    ]
    const out = rollUpKltLinks(rows)
    const byId = new Map(out.map((r) => [r.normalizedName, r]))
    expect(byId.get('root')!.links.map((l) => l.klp.id)).toEqual(['a'])
    expect(byId.get('mid')!.links.map((l) => l.klp.id)).toEqual(['a'])
  })

  it('keeps a leaf’s own links on itself even though ancestorIds excludes self', () => {
    const rows = [node({ id: 'leaf', ancestorIds: [], links: [link('a')] })]
    const out = rollUpKltLinks(rows)
    expect(out[0].links.map((l) => l.klp.id)).toEqual(['a'])
  })

  it('accumulates links from multiple children under one parent', () => {
    const rows = [
      node({ id: 'root', ancestorIds: [] }),
      node({ id: 'child1', ancestorIds: ['root'], links: [link('a')] }),
      node({ id: 'child2', ancestorIds: ['root'], links: [link('b')] }),
    ]
    const out = rollUpKltLinks(rows)
    const root = out.find((r) => r.normalizedName === 'root')!
    expect(root.links.map((l) => l.klp.id).sort()).toEqual(['a', 'b'])
  })

  it('reports nothing for an interior node with no linked descendants', () => {
    const rows = [
      node({ id: 'root', ancestorIds: [] }),
      node({ id: 'unrelated-leaf', ancestorIds: [], links: [link('a')] }),
    ]
    const out = rollUpKltLinks(rows)
    const root = out.find((r) => r.normalizedName === 'root')!
    expect(root.links).toEqual([])
  })

  it('passes depth and name through unchanged', () => {
    const rows = [node({ id: 'root', name: 'Accounting', depth: 3 })]
    const [out] = rollUpKltLinks(rows)
    expect(out.name).toBe('Accounting')
    expect(out.depth).toBe(3)
  })
})
