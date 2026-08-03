import { describe, it, expect } from 'vitest'
import {
  selectStaleCardIds,
  selectRefreshableStaleCardIds,
  StaleCandidate,
} from '@/lib/cards/stale'
import { klpSourceHash } from '@/lib/cards/klp-hash'

const term = 'WACC'
const definition = 'Weighted average cost of capital.'

function makeCard(overrides: Partial<StaleCandidate> = {}): StaleCandidate {
  return {
    id: 'card-1',
    term,
    definition,
    klpSourceHash: klpSourceHash({ term, definition }),
    ...overrides,
  }
}

describe('selectStaleCardIds', () => {
  it('treats a null stored hash as stale (new-card case)', () => {
    const card = makeCard({ klpSourceHash: null })
    expect(selectStaleCardIds([card])).toEqual([card.id])
  })

  it('does not flag a card whose stored hash matches its current content', () => {
    const card = makeCard()
    expect(selectStaleCardIds([card])).toEqual([])
  })

  it('flags a card whose term changed', () => {
    const card = makeCard({ term: 'CAPM' }) // stored hash still reflects the old term
    expect(selectStaleCardIds([card])).toEqual([card.id])
  })

  it('flags a card whose definition changed', () => {
    const card = makeCard({ definition: 'Something else entirely.' })
    expect(selectStaleCardIds([card])).toEqual([card.id])
  })

  it('flags a card whose content blocks changed: added, removed, or repointed', () => {
    const withBlock = makeCard({
      klpSourceHash: klpSourceHash({ term, definition }), // hash computed with NO blocks
      contentBlocks: [{ side: 'definition', type: 'image', assetId: 'asset-1', position: 0 }],
    })
    expect(selectStaleCardIds([withBlock])).toEqual([withBlock.id]) // block added

    const matchingBlocks = [{ side: 'definition', type: 'image', assetId: 'asset-1', position: 0 }]
    const withMatchingHash = makeCard({
      klpSourceHash: klpSourceHash({ term, definition, blocks: matchingBlocks }),
      contentBlocks: matchingBlocks,
    })
    expect(selectStaleCardIds([withMatchingHash])).toEqual([]) // blocks match, not stale

    const repointed = makeCard({
      klpSourceHash: klpSourceHash({ term, definition, blocks: matchingBlocks }),
      contentBlocks: [{ side: 'definition', type: 'image', assetId: 'asset-2', position: 0 }],
    })
    expect(selectStaleCardIds([repointed])).toEqual([repointed.id]) // asset repointed

    const removed = makeCard({
      klpSourceHash: klpSourceHash({ term, definition, blocks: matchingBlocks }),
      contentBlocks: [],
    })
    expect(selectStaleCardIds([removed])).toEqual([removed.id]) // block removed
  })

  it('treats an absent contentBlocks array the same as an empty one', () => {
    const withoutArray = makeCard() // no contentBlocks key at all
    const { contentBlocks: _omit, ...withEmptyArrayBase } = withoutArray as StaleCandidate & {
      contentBlocks?: never
    }
    const withEmptyArray = { ...withEmptyArrayBase, contentBlocks: [] }

    expect(selectStaleCardIds([withoutArray])).toEqual(selectStaleCardIds([withEmptyArray]))
    expect(selectStaleCardIds([withoutArray])).toEqual([])
  })

  it('returns only the stale ids from a mixed batch, preserving nothing else', () => {
    const fresh = makeCard({ id: 'fresh' })
    const staleTerm = makeCard({ id: 'stale-term', term: 'CAPM' })
    const staleNull = makeCard({ id: 'stale-null', klpSourceHash: null })
    const staleDefinition = makeCard({ id: 'stale-def', definition: 'Different.' })

    const result = selectStaleCardIds([fresh, staleTerm, staleNull, staleDefinition])

    expect(result).toEqual(['stale-term', 'stale-null', 'stale-def'])
  })
})

describe('selectRefreshableStaleCardIds (the updateSet variant)', () => {
  it('does not queue a legacy card whose stored hash is null', () => {
    // Every card predating the KLP feature has klpSourceHash: null. Treating
    // those as stale made the first one-word edit to a legacy set queue
    // extraction for EVERY card in it. ensureKlpsReady covers them on demand.
    const legacy = makeCard({ id: 'legacy', klpSourceHash: null })
    expect(selectRefreshableStaleCardIds([legacy])).toEqual([])
  })

  it('still queues a card whose stored hash no longer matches its content', () => {
    const edited = makeCard({ id: 'edited', term: 'CAPM' })
    expect(selectRefreshableStaleCardIds([edited])).toEqual(['edited'])
  })

  it('returns only genuinely-stale ids from a mixed legacy/edited/fresh set', () => {
    const fresh = makeCard({ id: 'fresh' })
    const legacy = makeCard({ id: 'legacy', klpSourceHash: null })
    const edited = makeCard({ id: 'edited', definition: 'Different.' })

    expect(selectRefreshableStaleCardIds([fresh, legacy, edited])).toEqual(['edited'])
    // selectStaleCardIds keeps its own null-is-stale semantics, unchanged:
    // createSet relies on it, where every card genuinely is new.
    expect(selectStaleCardIds([fresh, legacy, edited])).toEqual(['legacy', 'edited'])
  })
})
