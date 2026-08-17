import { describe, it, expect } from 'vitest'
import {
  parseStudyScope,
  resolveStudyScope,
  EMPTY_STUDY_SCOPE,
} from '@/lib/tuning/study-scope'
import { UNCATEGORIZED_ID } from '@/lib/cards/categories'

const AVAILABLE = {
  setIds: ['set-accounting', 'set-valuation'],
  categoryKeys: ['accounting', 'statements'],
}

describe('parseStudyScope', () => {
  it('treats null and undefined as an empty scope', () => {
    expect(parseStudyScope(null)).toEqual(EMPTY_STUDY_SCOPE)
    expect(parseStudyScope(undefined)).toEqual(EMPTY_STUDY_SCOPE)
  })

  it('round-trips a well-formed blob', () => {
    expect(parseStudyScope({ setIds: ['a'], categoryKeys: ['accounting'] })).toEqual({
      setIds: ['a'],
      categoryKeys: ['accounting'],
    })
  })

  it('fills a missing dimension rather than rejecting the whole blob', () => {
    expect(parseStudyScope({ setIds: ['a'] })).toEqual({ setIds: ['a'], categoryKeys: [] })
  })

  it('degrades a corrupt blob to empty instead of throwing', () => {
    // Empty means EVERYTHING, so a corrupt scope shows the learner more than
    // they asked for, never less. Degrading the other way would silently hide
    // their data behind a filter they cannot see.
    expect(parseStudyScope({ setIds: 'not-an-array' })).toEqual(EMPTY_STUDY_SCOPE)
    expect(parseStudyScope({ setIds: [1, 2] })).toEqual(EMPTY_STUDY_SCOPE)
    expect(parseStudyScope('garbage')).toEqual(EMPTY_STUDY_SCOPE)
  })

  it('rejects unknown keys rather than storing a setting nothing reads', () => {
    expect(parseStudyScope({ setIds: ['a'], categoryKeys: [], cardIds: ['x'] })).toEqual(
      EMPTY_STUDY_SCOPE,
    )
  })

  it('returns a fresh object so callers cannot mutate the shared empty', () => {
    const first = parseStudyScope(null)
    first.setIds.push('mutated')
    expect(parseStudyScope(null)).toEqual({ setIds: [], categoryKeys: [] })
  })
})

describe('resolveStudyScope', () => {
  it('does not report a widening when nothing was ever stored', () => {
    // The distinction that keeps every new user from being told a setting they
    // never touched has broken.
    const result = resolveStudyScope(EMPTY_STUDY_SCOPE, AVAILABLE)
    expect(result.scope).toEqual({ setIds: [], categoryKeys: [], sources: [] })
    expect(result.widened).toBe(false)
    expect(result.staleSetIds).toEqual([])
    expect(result.staleCategoryKeys).toEqual([])
  })

  it('passes a fully live scope through untouched', () => {
    const result = resolveStudyScope(
      { setIds: ['set-accounting'], categoryKeys: ['accounting'] },
      AVAILABLE,
    )
    expect(result.scope.setIds).toEqual(['set-accounting'])
    expect(result.scope.categoryKeys).toEqual(['accounting'])
    expect(result.widened).toBe(false)
  })

  it('keeps the survivors when only some references are dead', () => {
    const result = resolveStudyScope(
      {
        setIds: ['set-accounting', 'set-deleted'],
        categoryKeys: ['accounting', 'renamed-away'],
      },
      AVAILABLE,
    )
    expect(result.scope.setIds).toEqual(['set-accounting'])
    expect(result.scope.categoryKeys).toEqual(['accounting'])
    expect(result.staleSetIds).toEqual(['set-deleted'])
    expect(result.staleCategoryKeys).toEqual(['renamed-away'])
    expect(result.widened).toBe(false)
  })

  it('widens to everything and FLAGS IT when nothing survives', () => {
    const result = resolveStudyScope(
      { setIds: ['set-deleted'], categoryKeys: ['merged-away'] },
      AVAILABLE,
    )
    expect(result.scope).toEqual({ setIds: [], categoryKeys: [], sources: [] })
    // The flag is the point. A silent widening is the defect: the learner sees
    // recommendations from decks they excluded with no way to know why.
    expect(result.widened).toBe(true)
    expect(result.staleSetIds).toEqual(['set-deleted'])
    expect(result.staleCategoryKeys).toEqual(['merged-away'])
  })

  it('does not widen when one dimension dies but the other survives', () => {
    // The scope still means something, so dropping it would discard a live
    // instruction on account of a dead one.
    const result = resolveStudyScope(
      { setIds: ['set-deleted'], categoryKeys: ['accounting'] },
      AVAILABLE,
    )
    expect(result.scope.setIds).toEqual([])
    expect(result.scope.categoryKeys).toEqual(['accounting'])
    expect(result.widened).toBe(false)
  })

  it('never judges the Uncategorized sentinel stale', () => {
    // It is not a CardCategory row, so it can never appear in `available`. A
    // naive membership test drops the only bucket a learner with no categories
    // can pick — and then reports their scope as broken.
    const result = resolveStudyScope(
      { setIds: [], categoryKeys: [UNCATEGORIZED_ID] },
      { setIds: [], categoryKeys: [] },
    )
    expect(result.scope.categoryKeys).toEqual([UNCATEGORIZED_ID])
    expect(result.staleCategoryKeys).toEqual([])
    expect(result.widened).toBe(false)
  })

  it('resolves to an EMPTY_SCOPE-shaped object, not a partial one', () => {
    // The result is handed straight to `getLearnerMetrics`, whose scope
    // builders read `cardId` and `sources` as well.
    const result = resolveStudyScope({ setIds: ['set-accounting'], categoryKeys: [] }, AVAILABLE)
    expect(result.scope.cardId).toBeUndefined()
    expect(result.scope.sources).toEqual([])
  })

  it('gives each result its OWN sources array, not the module constant', () => {
    // `{ ...EMPTY_SCOPE }` would share the constant's array by reference, so
    // one caller mutating its scope would corrupt every later one. Same hazard
    // `parseStudyScope` guards against.
    const a = resolveStudyScope({ setIds: [], categoryKeys: [] }, AVAILABLE)
    const b = resolveStudyScope({ setIds: [], categoryKeys: [] }, AVAILABLE)
    expect(a.scope.sources).not.toBe(b.scope.sources)
  })
})
