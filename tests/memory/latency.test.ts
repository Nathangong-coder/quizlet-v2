import { describe, it, expect } from 'vitest'
import { normalizeLatency, MAX_LATENCY_MS } from '../../src/lib/memory/latency'

describe('normalizeLatency', () => {
  it('passes through a plausible measurement, rounded', () => {
    expect(normalizeLatency(4200.7)).toBe(4201)
    expect(normalizeLatency(0)).toBe(0)
  })

  it('discards a measurement above the ceiling', () => {
    // The user walked away mid-question. One such value would wreck every
    // median and outlier calculation downstream, so it is recorded as
    // "unknown" rather than as a real 40-minute answer.
    expect(normalizeLatency(MAX_LATENCY_MS + 1)).toBeNull()
  })

  it('keeps a measurement exactly at the ceiling', () => {
    expect(normalizeLatency(MAX_LATENCY_MS)).toBe(MAX_LATENCY_MS)
  })

  it('discards missing, negative, and non-finite values', () => {
    expect(normalizeLatency(undefined)).toBeNull()
    expect(normalizeLatency(null)).toBeNull()
    expect(normalizeLatency(-1)).toBeNull()
    expect(normalizeLatency(NaN)).toBeNull()
    expect(normalizeLatency(Infinity)).toBeNull()
  })
})
