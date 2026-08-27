import { describe, it, expect } from 'vitest'
import {
  checkForkSize, describeForkRefusal, FORK_MAX_CARDS, FORK_ASSET_BUDGET_BYTES,
} from '@/lib/sets/fork'

describe('checkForkSize', () => {
  it('allows an ordinary set', () => {
    const v = checkForkSize({ cardCount: 84, assetSizes: [1_000_000, 2_000_000] })
    expect(v).toEqual({ ok: true, totalAssetBytes: 3_000_000 })
  })

  it('allows a set with no assets at all', () => {
    expect(checkForkSize({ cardCount: 10, assetSizes: [] })).toEqual({
      ok: true, totalAssetBytes: 0,
    })
  })

  it('allows exactly the card limit', () => {
    // `>` not `>=`. A set at exactly the limit is within it, and off-by-one
    // here is a refusal the user cannot act on.
    expect(checkForkSize({ cardCount: FORK_MAX_CARDS, assetSizes: [] }).ok).toBe(true)
  })

  it('refuses one card over the limit, naming the numbers', () => {
    const v = checkForkSize({ cardCount: FORK_MAX_CARDS + 1, assetSizes: [] })
    expect(v).toEqual({
      ok: false, reason: 'too_many_cards', limit: FORK_MAX_CARDS, actual: FORK_MAX_CARDS + 1,
    })
  })

  it('allows exactly the asset budget', () => {
    expect(checkForkSize({ cardCount: 1, assetSizes: [FORK_ASSET_BUDGET_BYTES] }).ok).toBe(true)
  })

  it('refuses one byte over the asset budget', () => {
    const v = checkForkSize({ cardCount: 1, assetSizes: [FORK_ASSET_BUDGET_BYTES + 1] })
    expect(v).toEqual({
      ok: false,
      reason: 'assets_too_large',
      limit: FORK_ASSET_BUDGET_BYTES,
      actual: FORK_ASSET_BUDGET_BYTES + 1,
    })
  })

  it('sums many assets rather than checking each', () => {
    const half = FORK_ASSET_BUDGET_BYTES / 2
    const v = checkForkSize({ cardCount: 1, assetSizes: [half, half, 1] })
    expect(v.ok).toBe(false)
  })

  it('checks cards BEFORE assets', () => {
    // Both gates fail here. Cards is the cheaper fact and the one the user can
    // most easily act on, so it is the one reported.
    const v = checkForkSize({
      cardCount: FORK_MAX_CARDS + 1,
      assetSizes: [FORK_ASSET_BUDGET_BYTES + 1],
    })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('too_many_cards')
  })

  it('ignores negative or non-finite sizes rather than trusting them', () => {
    // sizeBytes comes from an upload path; a bad row must not be able to buy
    // budget back for a genuinely oversized set.
    const v = checkForkSize({ cardCount: 1, assetSizes: [-5, NaN, 1000] })
    expect(v).toEqual({ ok: true, totalAssetBytes: 1000 })
  })
})

describe('describeForkRefusal', () => {
  it('names the card limit and the actual count', () => {
    const msg = describeForkRefusal({
      ok: false, reason: 'too_many_cards', limit: 1000, actual: 1500,
    })
    expect(msg).toContain('1,500')
    expect(msg).toContain('1,000')
  })

  it('reports asset sizes in MB, not bytes', () => {
    // "this set is too large" with no number is not actionable, and
    // 104857600 is not a number anybody reads.
    const msg = describeForkRefusal({
      ok: false, reason: 'assets_too_large', limit: 104857600, actual: 157286400,
    })
    expect(msg).toContain('150 MB')
    expect(msg).toContain('100 MB')
    expect(msg).not.toContain('104857600')
  })
})
