import { describe, it, expect } from 'vitest'
import {
  SEPARATION_FLOOR, MAX_REVISIONS, MIN_KLPS_PER_CARD, MIN_KLPS_FLOOR, MAX_KLPS_AUTHORED,
  WEIGHT_GRAPH_TERM, WEIGHT_EVIDENCE_TERM, BLAST_RADIUS_FULL,
  HISTOGRAM_CLUSTER_SHARE, HISTOGRAM_UNIFORM_SHARE,
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

  /**
   * The floor dropped from 5 to 4 with increment A's adaptive sizing — the
   * owner's "base of 4+". The upper bound is unchanged.
   */
  it('floors the AUTHORING pipeline at 4 KLPs per card and caps it at 9', () => {
    expect(MIN_KLPS_FLOOR).toBe(4)
    expect(MIN_KLPS_PER_CARD).toBe(MIN_KLPS_FLOOR)
    expect(MAX_KLPS_AUTHORED).toBe(9)
  })

  /**
   * Increment A §1's two weight signals. Equal weighting is a declared STARTING
   * POINT, to be revisited against the first real histogram — this assertion
   * exists so a rebalance is a deliberate edit with a test to update, not a
   * silent drift that changes every weight the pipeline writes.
   */
  it('blends the two weight signals equally, for now', () => {
    expect(WEIGHT_GRAPH_TERM).toBe(0.5)
    expect(WEIGHT_EVIDENCE_TERM).toBe(0.5)
    expect(WEIGHT_GRAPH_TERM + WEIGHT_EVIDENCE_TERM).toBe(1)
    expect(BLAST_RADIUS_FULL).toBe(4)
  })

  /**
   * The histogram thresholds must REJECT the condition the increment exists to
   * fix — 92.3% of live weights at 4-5 — with room to spare rather than sitting
   * on the boundary.
   */
  it('sets histogram thresholds that reject the measured G1 baseline', () => {
    expect(HISTOGRAM_CLUSTER_SHARE).toBeLessThan(0.923)
    expect(HISTOGRAM_UNIFORM_SHARE).toBeLessThan(HISTOGRAM_CLUSTER_SHARE)
  })

  /**
   * The legacy demand-driven extraction path (extract-klps.ts) must stay at
   * its historical cap of 5 until a later spec retires it. This constant is
   * shared prompt copy and Zod schema behaviour for cards that never go
   * through authoring — widening it once already leaked into that path, and
   * this assertion is what stops it from happening silently again.
   */
  it('leaves the legacy cap at 5 — MAX_KLPS_PER_CARD must not silently widen', () => {
    expect(MAX_KLPS_PER_CARD).toBe(5)
  })

  it('grades candidates separately by default', () => {
    expect(GRADE_CANDIDATES_SEPARATELY).toBe(true)
  })

  it('names exactly the three adversary archetypes', () => {
    expect(PROBE_KINDS).toEqual(['confident_wrong', 'vague', 'memorized_template'])
  })
})
