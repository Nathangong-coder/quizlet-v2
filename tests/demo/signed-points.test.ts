import { describe, expect, it } from 'vitest'
import {
  guestCardHash,
  signPoints,
  verifyPoints,
  type GuestPoint,
} from '@/lib/demo/signed-points'

const SECRET = 'test-secret-0123456789'
const card = { term: 'EBITDA', definition: 'Earnings before interest, taxes, depreciation, amortization' }
const points: GuestPoint[] = [
  { text: 'Excludes interest and taxes', weight: 3, kind: 'definition' },
  { text: 'Proxy for operating cash flow', weight: 2, kind: 'mechanism' },
]

describe('signed guest points', () => {
  it('verifies a signed set', () => {
    const signed = signPoints(card, points, SECRET)
    expect(signed.cardHash).toBe(guestCardHash(card))
    expect(verifyPoints(card, signed, SECRET)).toEqual(points)
  })

  it('survives a JSON round trip', () => {
    const signed = JSON.parse(JSON.stringify(signPoints(card, points, SECRET)))
    expect(verifyPoints(card, signed, SECRET)).toEqual(points)
  })

  it('rejects changed point text', () => {
    const signed = signPoints(card, points, SECRET)
    const forged = { ...signed, points: [{ ...points[0], text: 'Anything' }, points[1]] }
    expect(verifyPoints(card, forged, SECRET)).toBeNull()
  })

  it('rejects an added point', () => {
    const signed = signPoints(card, points, SECRET)
    const forged = { ...signed, points: [...points, { text: 'Extra', weight: 1, kind: 'definition' }] }
    expect(verifyPoints(card, forged, SECRET)).toBeNull()
  })

  it('rejects an edited card definition', () => {
    const signed = signPoints(card, points, SECRET)
    expect(verifyPoints({ ...card, definition: 'Something else' }, signed, SECRET)).toBeNull()
  })

  it('rejects a different secret', () => {
    const signed = signPoints(card, points, SECRET)
    expect(verifyPoints(card, signed, 'other-secret')).toBeNull()
  })

  it('rejects malformed input', () => {
    const signed = signPoints(card, points, SECRET)
    expect(verifyPoints(card, {}, SECRET)).toBeNull()
    expect(verifyPoints(card, null, SECRET)).toBeNull()
    expect(verifyPoints(card, { ...signed, sig: 123 }, SECRET)).toBeNull()
  })
})
