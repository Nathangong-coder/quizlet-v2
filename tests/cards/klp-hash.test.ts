import { describe, it, expect } from 'vitest'
import { klpSourceHash } from '@/lib/cards/klp-hash'

const base = { term: 'WACC', definition: 'Weighted average cost of capital.' }

describe('klpSourceHash', () => {
  it('is stable across calls with identical input', () => {
    expect(klpSourceHash(base)).toBe(klpSourceHash(base))
  })

  it('returns a hex sha256 digest', () => {
    expect(klpSourceHash(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the term or definition changes', () => {
    expect(klpSourceHash({ ...base, term: 'CAPM' })).not.toBe(klpSourceHash(base))
    expect(klpSourceHash({ ...base, definition: 'Something else.' })).not.toBe(
      klpSourceHash(base),
    )
  })

  it('does not confuse a term/definition boundary shift', () => {
    // Naive concatenation would hash "AB" + "C" the same as "A" + "BC".
    expect(klpSourceHash({ term: 'AB', definition: 'C' })).not.toBe(
      klpSourceHash({ term: 'A', definition: 'BC' }),
    )
  })

  it('ignores block ordering, hashing by side and position instead', () => {
    // The editor may serialize blocks in any order; only their content and
    // their position within a side is meaning-bearing.
    const blocks = [
      { side: 'term', type: 'text', text: 'a', position: 0 },
      { side: 'definition', type: 'image', assetId: 'asset-1', position: 0 },
    ]
    expect(klpSourceHash({ ...base, blocks })).toBe(
      klpSourceHash({ ...base, blocks: [...blocks].reverse() }),
    )
  })

  it('changes when a block is added, removed, or repointed', () => {
    const withBlock = {
      ...base,
      blocks: [{ side: 'definition', type: 'image', assetId: 'asset-1', position: 0 }],
    }
    expect(klpSourceHash(withBlock)).not.toBe(klpSourceHash(base))
    expect(
      klpSourceHash({
        ...base,
        blocks: [{ side: 'definition', type: 'image', assetId: 'asset-2', position: 0 }],
      }),
    ).not.toBe(klpSourceHash(withBlock))
  })

  it('treats an absent blocks array and an empty one identically', () => {
    expect(klpSourceHash({ ...base, blocks: [] })).toBe(klpSourceHash(base))
  })
})
