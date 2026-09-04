import { describe, it, expect } from 'vitest'
import {
  SEPARATION_FLOOR, MAX_REVISIONS, MIN_KLPS_PER_CARD,
  GRADE_CANDIDATES_SEPARATELY, PROBE_KINDS,
} from '@/lib/klp/authoring-config'
import { MAX_KLPS_PER_CARD } from '@/lib/ai/schemas'

describe('authoring config', () => {
  /**
   * The user's own failure case: "if your vague answer scores 6/7, your KLPs
   * are too loose". 6/7 = 0.857, so against a reference at 1.0 the separation
   * is 0.143 — the floor must reject that with room to spare, not sit on it.
   */
  it('sets a floor that rejects the 6-of-7 case by a wide margin', () => {
    const separation = 1 - 6 / 7
    expect(separation).toBeLessThan(SEPARATION_FLOOR)
    expect(SEPARATION_FLOOR - separation).toBeGreaterThan(0.2)
  })

  it('still lets a good adversary earn most of the way to the floor', () => {
    // The confident-but-wrong answer SHOULD get structural points right.
    expect(1 - SEPARATION_FLOOR).toBeGreaterThanOrEqual(0.6)
  })

  it('caps revisions so a card cannot loop forever on the key pool', () => {
    expect(MAX_REVISIONS).toBe(2)
  })

  it('targets 5-9 KLPs per card, up from the old cap of 5', () => {
    expect(MIN_KLPS_PER_CARD).toBe(5)
    expect(MAX_KLPS_PER_CARD).toBe(9)
  })

  it('grades candidates separately by default', () => {
    expect(GRADE_CANDIDATES_SEPARATELY).toBe(true)
  })

  it('names exactly the three adversary archetypes', () => {
    expect(PROBE_KINDS).toEqual(['confident_wrong', 'vague', 'memorized_template'])
  })
})
