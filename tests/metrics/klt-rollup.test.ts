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

const node = (over: Partial<KltNodeRow> & { kltId: string }): KltNodeRow => ({
  normalizedName: over.kltId,
  name: over.kltId,
  depth: 0,
  ancestorIds: [],
  links: [],
  ...over,
})

describe('rollUpKltLinks', () => {
  it('folds a leaf’s own links into every ancestor named in ancestorIds', () => {
    // accounting (root) -> gaap (mid) -> revenue-recognition (leaf)
    const rows = [
      node({ kltId: 'root', ancestorIds: [] }),
      node({ kltId: 'mid', ancestorIds: ['root'] }),
      node({ kltId: 'leaf', ancestorIds: ['root', 'mid'], links: [link('a')] }),
    ]
    const out = rollUpKltLinks(rows)
    const byId = new Map(out.map((r) => [r.normalizedName, r]))
    expect(byId.get('root')!.links.map((l) => l.klp.id)).toEqual(['a'])
    expect(byId.get('mid')!.links.map((l) => l.klp.id)).toEqual(['a'])
  })

  it('keeps a leaf’s own links on itself even though ancestorIds excludes self', () => {
    const rows = [node({ kltId: 'leaf', ancestorIds: [], links: [link('a')] })]
    const out = rollUpKltLinks(rows)
    expect(out[0].links.map((l) => l.klp.id)).toEqual(['a'])
  })

  it('accumulates links from multiple children under one parent', () => {
    const rows = [
      node({ kltId: 'root', ancestorIds: [] }),
      node({ kltId: 'child1', ancestorIds: ['root'], links: [link('a')] }),
      node({ kltId: 'child2', ancestorIds: ['root'], links: [link('b')] }),
    ]
    const out = rollUpKltLinks(rows)
    const root = out.find((r) => r.normalizedName === 'root')!
    expect(root.links.map((l) => l.klp.id).sort()).toEqual(['a', 'b'])
  })

  it('reports nothing for an interior node with no linked descendants', () => {
    const rows = [
      node({ kltId: 'root', ancestorIds: [] }),
      node({ kltId: 'unrelated-leaf', ancestorIds: [], links: [link('a')] }),
    ]
    const out = rollUpKltLinks(rows)
    const root = out.find((r) => r.normalizedName === 'root')!
    expect(root.links).toEqual([])
  })

  it('passes depth and name through unchanged', () => {
    const rows = [node({ kltId: 'root', name: 'Accounting', depth: 3 })]
    const [out] = rollUpKltLinks(rows)
    expect(out.name).toBe('Accounting')
    expect(out.depth).toBe(3)
  })
})

describe('buildAncestorClosureByName', () => {
  it('includes self plus every ancestor, translated from id to normalizedName', () => {
    const closure = buildAncestorClosureByName([
      node({ kltId: 'root', normalizedName: 'accounting', ancestorIds: [] }),
      node({ kltId: 'mid', normalizedName: 'gaap', ancestorIds: ['root'] }),
      node({ kltId: 'leaf', normalizedName: 'revrec', ancestorIds: ['root', 'mid'] }),
    ])
    expect(closure.get('revrec')).toEqual(['revrec', 'accounting', 'gaap'])
  })

  it('is just self for a root, which has no ancestors', () => {
    const closure = buildAncestorClosureByName([
      node({ kltId: 'root', normalizedName: 'accounting', ancestorIds: [] }),
    ])
    expect(closure.get('accounting')).toEqual(['accounting'])
  })
})

describe('countAnalyzedAnswersByTopic — readiness’s denominator fold (review finding, 2026-08-25)', () => {
  // `Klt.ancestorIds` is a list of IDS; the closure maps NAMES, so these
  // fixtures build both — matching what `loadKltRows`/`buildAncestorClosureByName`
  // actually hand the counter in production.
  const closure = buildAncestorClosureByName([
    node({ kltId: 'root', normalizedName: 'accounting', ancestorIds: [] }),
    node({ kltId: 'leaf1', normalizedName: 'revrec', ancestorIds: ['root'] }),
    node({ kltId: 'leaf2', normalizedName: 'matching', ancestorIds: ['root'] }),
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
    node({ kltId: 'root', normalizedName: 'accounting', name: 'Accounting', ancestorIds: [] }),
    node({
      kltId: 'leaf', normalizedName: 'revrec', name: 'Revenue Recognition', depth: 1,
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

describe('per-set-then-union rollup (Task 3, spec §6.2)', () => {
  // `rollUpKltLinks` is called ONCE PER SET by `loadKltRows`, and the results
  // are concatenated before `kltRowsToTopicRows`/`shapeTopicProfile` group by
  // `normalizedName`. This block proves that pipeline end to end: an interior
  // node is credited ONLY from its own set's descendants, and a concept that
  // exists in two sets is unioned by klpId, not concatenated into a double
  // count.

  it('credits an interior node only from descendants WITHIN ITS OWN SET', () => {
    // Set A: accounting -> revrec (leaf, link 'a1'). Set B reuses the SAME
    // kltId for 'accounting' as a root with NO descendants and no links of
    // its own. Rolling set B alone must not see set A's 'a1'.
    const setARows = [
      node({ kltId: 'accounting', ancestorIds: [] }),
      node({ kltId: 'revrec', ancestorIds: ['accounting'], links: [link('a1')] }),
    ]
    const setBRows = [node({ kltId: 'accounting', ancestorIds: [] })]

    const setBOut = rollUpKltLinks(setBRows)
    expect(setBOut.find((r) => r.normalizedName === 'accounting')!.links).toEqual([])

    // Sanity: set A's own rollup DOES see it — proves the fixture is real.
    const setAOut = rollUpKltLinks(setARows)
    expect(
      setAOut.find((r) => r.normalizedName === 'accounting')!.links.map((l) => l.klp.id),
    ).toEqual(['a1'])
  })

  it('unions a concept present in two sets ONCE PER SET, not double-counted', () => {
    // 'accounting' rolls up a different leaf in each set: set A's 'revrec'
    // (klp 'a1') and set B's 'matching' (klp 'b1'). Each set's own leaf must
    // never see the OTHER set's link — the double-count this test exists to
    // catch is 'a1' or 'b1' appearing twice, or one set's rollup leaking the
    // other's klp into a node that never had it.
    const setARows = [
      node({ kltId: 'accounting', ancestorIds: [] }),
      node({ kltId: 'revrec', ancestorIds: ['accounting'], links: [link('a1')] }),
    ]
    const setBRows = [
      node({ kltId: 'accounting', ancestorIds: [] }),
      node({ kltId: 'matching', ancestorIds: ['accounting'], links: [link('b1')] }),
    ]

    // This is exactly what `loadKltRows` does: resolve each set independently…
    const perSetTopics = [...rollUpKltLinks(setARows), ...rollUpKltLinks(setBRows)]

    // …then concatenate and let the shared shaper union by klpId.
    const topicRows = kltRowsToTopicRows(perSetTopics, 3)
    const shaped = shapeTopicProfile({
      topics: topicRows, knowledge: {}, tags: [], analyzedAnswersByTopic: {},
    })

    const accounting = shaped.find((t) => t.key === 'accounting')
    expect(accounting).toBeDefined()
    // Both leaves' klps present exactly once each — a union, not empty and
    // not doubled (which concatenating raw `links` arrays without the
    // klpId-`Set` dedup in `kltRowsToTopicRows`/`shapeTopicProfile` would do
    // if either klp were, e.g., accidentally visible to both sets' rollups).
    expect(accounting!.klpCount).toBe(2)

    // And each set's OWN interior node is not itself doubled: exactly one
    // 'accounting' RawKltRow came from each set, each correctly scoped to
    // only that set's leaf.
    const accountingRows = perSetTopics.filter((r) => r.normalizedName === 'accounting')
    expect(accountingRows).toHaveLength(2)
    expect(accountingRows[0].links.map((l) => l.klp.id)).toEqual(['a1'])
    expect(accountingRows[1].links.map((l) => l.klp.id)).toEqual(['b1'])
  })

  it('an empty set structure yields no topics rather than throwing', () => {
    expect(() => rollUpKltLinks([])).not.toThrow()
    expect(rollUpKltLinks([])).toEqual([])

    const topicRows = kltRowsToTopicRows(rollUpKltLinks([]), 3)
    expect(topicRows).toEqual([])
    expect(
      shapeTopicProfile({ topics: topicRows, knowledge: {}, tags: [], analyzedAnswersByTopic: {} }),
    ).toEqual([])
  })
})
