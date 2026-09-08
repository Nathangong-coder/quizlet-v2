import { describe, it, expect } from 'vitest'
import { pickDonor, type ReuseDonor } from '@/lib/klp/reuse'

function donor(over: Partial<ReuseDonor> = {}): ReuseDonor {
  return { cardId: 'c1', setId: 's1', klpCount: 5, promptVersion: 2, ...over }
}

/**
 * Which donor's key points get copied onto an identical card.
 *
 * The rule matters because legacy single-pass extraction and the
 * discrimination-tested pipeline can both match the same content hash. Copying
 * the legacy one spends the reuse opportunity on the weaker artifact — exactly
 * what the authoring pipeline exists to replace.
 */
describe('pickDonor', () => {
  it('returns null when nothing matches', () => {
    expect(pickDonor([])).toBeNull()
  })

  it('prefers the higher prompt version over the larger key-point count', () => {
    // The legacy extractor is not merely older, it produced measurably worse
    // weights (92.3% clustered at 4-5). More of a worse artifact is not better.
    const legacy = donor({ cardId: 'legacy', promptVersion: 1, klpCount: 9 })
    const authored = donor({ cardId: 'authored', promptVersion: 2, klpCount: 4 })
    expect(pickDonor([legacy, authored])?.cardId).toBe('authored')
  })

  it('breaks a version tie on key-point count', () => {
    const thin = donor({ cardId: 'thin', promptVersion: 4, klpCount: 3 })
    const full = donor({ cardId: 'full', promptVersion: 4, klpCount: 8 })
    expect(pickDonor([thin, full])?.cardId).toBe('full')
  })

  it('does not mutate the array it was given', () => {
    // It sorts internally; a caller iterating the same list afterwards must
    // not silently see a different order.
    const list = [donor({ cardId: 'a', promptVersion: 1 }), donor({ cardId: 'b', promptVersion: 3 })]
    pickDonor(list)
    expect(list.map((d) => d.cardId)).toEqual(['a', 'b'])
  })

  it('handles a single candidate', () => {
    expect(pickDonor([donor({ cardId: 'only' })])?.cardId).toBe('only')
  })
})
