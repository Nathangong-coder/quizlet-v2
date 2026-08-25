import { describe, it, expect } from 'vitest'
import {
  rollUpKltLinks, buildAncestorClosureByName, countAnalyzedAnswersByTopic,
  type KltNodeRow,
} from '@/lib/metrics/klt-rollup'
import { kltRowsToTopicRows, shapeTopicProfile } from '@/lib/memory/topic-profile'

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

describe('buildAncestorClosureByName', () => {
  it('includes self plus every ancestor, translated from id to normalizedName', () => {
    const closure = buildAncestorClosureByName([
      node({ id: 'root', normalizedName: 'accounting', ancestorIds: [] }),
      node({ id: 'mid', normalizedName: 'gaap', ancestorIds: ['root'] }),
      node({ id: 'leaf', normalizedName: 'revrec', ancestorIds: ['root', 'mid'] }),
    ])
    expect(closure.get('revrec')).toEqual(['revrec', 'accounting', 'gaap'])
  })

  it('is just self for a root, which has no ancestors', () => {
    const closure = buildAncestorClosureByName([
      node({ id: 'root', normalizedName: 'accounting', ancestorIds: [] }),
    ])
    expect(closure.get('accounting')).toEqual(['accounting'])
  })
})

describe('countAnalyzedAnswersByTopic — readiness’s denominator fold (review finding, 2026-08-25)', () => {
  // `Klt.ancestorIds` is a list of IDS; the closure maps NAMES, so these
  // fixtures build both — matching what `loadKltRows`/`buildAncestorClosureByName`
  // actually hand the counter in production.
  const closure = buildAncestorClosureByName([
    node({ id: 'root', normalizedName: 'accounting', ancestorIds: [] }),
    node({ id: 'leaf1', normalizedName: 'revrec', ancestorIds: ['root'] }),
    node({ id: 'leaf2', normalizedName: 'matching', ancestorIds: ['root'] }),
  ])

  it('credits an interior node for an answer whose DIRECT topic is only a descendant leaf', () => {
    // This is the direct regression: `accounting` holds no direct KLP links —
    // every key point sits on `revrec`, a leaf beneath it — so before the fold
    // this always read 0, permanently, no matter how much evidence existed.
    const counts = countAnalyzedAnswersByTopic([{ topicNames: ['revrec'] }], closure)
    expect(counts.accounting).toBe(1)
    expect(counts.revrec).toBe(1)
  })

  it('counts one answer ONCE for a shared ancestor, even across two different direct topics', () => {
    // One answer, on a card whose two KLPs sit under two DIFFERENT leaves
    // (`revrec`, `matching`) that share one ancestor (`accounting`). The
    // pre-existing "once per topic" rule already stopped a single REPEATED
    // topic from inflating its own count; this pins that the rule also holds
    // once the topics differ but fold up to the same ancestor.
    const counts = countAnalyzedAnswersByTopic(
      [{ topicNames: ['revrec', 'matching'] }],
      closure,
    )
    expect(counts.accounting).toBe(1)
    expect(counts.revrec).toBe(1)
    expect(counts.matching).toBe(1)
  })

  it('falls back to the direct name alone for a topic the closure map has no entry for', () => {
    const counts = countAnalyzedAnswersByTopic([{ topicNames: ['unmapped'] }], new Map())
    expect(counts.unmapped).toBe(1)
  })
})

describe('interior-node readiness rolls up end to end (review finding, 2026-08-25)', () => {
  // Wires the real numerator fold (`rollUpKltLinks` + `kltRowsToTopicRows`)
  // and the real denominator fold (`countAnalyzedAnswersByTopic`) into the
  // SAME `shapeTopicProfile` both axes share — no DB, no mocks, every
  // function imported for real. `accounting` (root) holds no direct links;
  // every key point sits on `revrec`, a leaf beneath it.
  const treeRows = [
    node({ id: 'root', normalizedName: 'accounting', name: 'Accounting', ancestorIds: [] }),
    node({
      id: 'leaf', normalizedName: 'revrec', name: 'Revenue Recognition', depth: 1,
      ancestorIds: ['root'], links: [link('k1')],
    }),
  ]

  it('reports a NON-NULL readiness for the interior node once its denominator rolls up too', () => {
    const topicRows = kltRowsToTopicRows(rollUpKltLinks(treeRows), 3)
    const closure = buildAncestorClosureByName(treeRows)
    const analyzedAnswersByTopic = countAnalyzedAnswersByTopic(
      [{ topicNames: ['revrec'] }],
      closure,
    )
    const shaped = shapeTopicProfile({
      topics: topicRows, knowledge: {}, tags: [], analyzedAnswersByTopic,
    })
    const accounting = shaped.find((t) => t.key === 'accounting')
    expect(accounting).toBeDefined()
    expect(accounting!.readiness).not.toBeNull()
  })

  it('regresses to null without the denominator fold — proving the test above is not vacuous', () => {
    // Same tree, same links, but the denominator is built WITHOUT folding
    // (the exact bug): only the leaf's own direct topic is counted.
    const topicRows = kltRowsToTopicRows(rollUpKltLinks(treeRows), 3)
    const unfoldedAnalyzedAnswersByTopic = { revrec: 1 } // no 'accounting' entry
    const shaped = shapeTopicProfile({
      topics: topicRows, knowledge: {}, tags: [],
      analyzedAnswersByTopic: unfoldedAnalyzedAnswersByTopic,
    })
    const accounting = shaped.find((t) => t.key === 'accounting')
    expect(accounting!.readiness).toBeNull()
  })
})
