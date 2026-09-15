import { describe, it, expect } from 'vitest'
import { layoutDag, filterDag, findBackEdges, assignLayers, orderLayers, DAG_DEFAULTS } from '@/lib/klt/dag-layout'

const n = (id: string) => ({ kltId: id, name: id })
const e = (from: string, to: string, type = 'causes', cardCount = 1, provenance = 'minted') => ({ fromKltId: from, toKltId: to, type, cardCount, provenance })

describe('filterDag', () => {
  it('keeps only directed edges between known nodes and drops self-loops', () => {
    const r = filterDag([n('a'), n('b')], [e('a', 'b'), e('a', 'a'), e('a', 'zz'), e('a', 'b', 'confused_with')])
    expect(r.edges).toHaveLength(1)
    expect(r.total).toBe(1)
    expect(r.nodes.map((x) => x.kltId)).toEqual(['a', 'b'])
  })
  it('applies min cards and provenance', () => {
    const edges = [e('a', 'b', 'causes', 1, 'minted'), e('b', 'c', 'requires', 3, 'rolled')]
    expect(filterDag([n('a'), n('b'), n('c')], edges, { minCards: 2 }).edges).toHaveLength(1)
    expect(filterDag([n('a'), n('b'), n('c')], edges, { provenances: new Set(['minted']) }).edges.map((x) => x.provenance)).toEqual(['minted'])
  })
  it('focus keeps the k-hop neighbourhood in either direction, and the focus node itself when isolated', () => {
    const nodes = ['a', 'b', 'c', 'd', 'x'].map(n)
    const edges = [e('a', 'b'), e('b', 'c'), e('c', 'd')]
    const one = filterDag(nodes, edges, { focusKltId: 'b', hops: 1 })
    expect(one.nodes.map((v) => v.kltId).sort()).toEqual(['a', 'b', 'c'])
    const two = filterDag(nodes, edges, { focusKltId: 'b', hops: 2 })
    expect(two.nodes.map((v) => v.kltId).sort()).toEqual(['a', 'b', 'c', 'd'])
    const iso = filterDag(nodes, edges, { focusKltId: 'x' })
    expect(iso.nodes.map((v) => v.kltId)).toEqual(['x'])
    expect(iso.edges).toHaveLength(0)
  })
})

describe('findBackEdges / assignLayers', () => {
  it('breaks a cycle by one back-edge and layers by longest path', () => {
    const ids = ['a', 'b', 'c', 'd']
    const edges = [e('a', 'b'), e('b', 'c'), e('c', 'a'), e('a', 'd'), e('d', 'c')]
    const back = findBackEdges(ids, edges)
    expect(back.size).toBe(1)
    const forward = edges.filter((x) => !back.has(`${x.fromKltId}|${x.toKltId}`))
    const layer = assignLayers(ids, forward)
    // a → b → c and a → d → c: c is two steps from a either way
    expect(layer.get('a')).toBe(0)
    expect(layer.get('c')).toBe(2)
    expect(layer.get('d')).toBe(1)
  })
  it('an isolated node sits in layer 0', () => {
    expect(assignLayers(['x'], []).get('x')).toBe(0)
  })
})

describe('orderLayers', () => {
  it('puts a child under its parent rather than in alphabetical order', () => {
    // layer 0: a, z ; layer 1: p (from z), q (from a). Alphabetical would be p, q; barycentre gives q, p.
    const ids = ['a', 'z', 'p', 'q']
    const names = new Map(ids.map((i) => [i, i]))
    const edges = [e('z', 'p'), e('a', 'q')]
    const layer = assignLayers(ids, edges)
    const layers = orderLayers(ids, names, layer, edges)
    expect(layers[0]).toEqual(['a', 'z'])
    expect(layers[1]).toEqual(['q', 'p'])
  })
})

describe('layoutDag', () => {
  it('lays columns left to right, arrows forward, and reports counts', () => {
    const l = layoutDag([n('a'), n('b'), n('c')], [e('a', 'b', 'causes', 2), e('b', 'c', 'requires', 1), e('a', 'c', 'confused_with')])
    expect(l.layers).toBe(3)
    expect(l.total).toBe(2)
    expect(l.kept).toBe(2)
    const [a, b, c] = ['a', 'b', 'c'].map((id) => l.nodes.find((x) => x.kltId === id)!)
    expect(a.x).toBeLessThan(b.x)
    expect(b.x).toBeLessThan(c.x)
    expect(l.width).toBe(3 * DAG_DEFAULTS.nodeWidth + 2 * DAG_DEFAULTS.hGap)
    expect(l.height).toBe(DAG_DEFAULTS.nodeHeight)
    expect(a.outDegree).toBe(1)
    expect(c.inDegree).toBe(1)
    const ab = l.edges.find((x) => x.fromKltId === 'a')!
    expect(ab.cardCount).toBe(2)
    expect(ab.backEdge).toBe(false)
    expect(ab.path.startsWith(`M ${DAG_DEFAULTS.nodeWidth} `)).toBe(true)
  })
  it('still draws a back-edge, flagged, and centres shorter columns', () => {
    const l = layoutDag([n('a'), n('b'), n('c')], [e('a', 'b'), e('b', 'a'), e('a', 'c')])
    expect(l.edges.filter((x) => x.backEdge)).toHaveLength(1)
    expect(l.layers).toBe(2)
    const a = l.nodes.find((x) => x.kltId === 'a')!
    // layer 1 holds b and c; a alone in layer 0 is centred on that column's height
    expect(a.y).toBeGreaterThan(0)
  })
  it('an empty input is an empty drawing', () => {
    const l = layoutDag([], [])
    expect(l.nodes).toEqual([])
    expect(l.width).toBe(0)
    expect(l.height).toBe(0)
  })
})
