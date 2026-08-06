import { describe, it, expect } from 'vitest'
import { sessionShape, MIN_ITEMS_FOR_SHAPE } from '@/lib/metrics/session-shape'
import type { ShapeItem } from '@/lib/metrics/session-shape'

const item = (correct: boolean, latencyMs: number): ShapeItem => ({ correct, latencyMs })

describe('insufficient data', () => {
  it('returns null below 6 items — thirds of a 4-item quiz measure noise', () => {
    const items = Array.from({ length: MIN_ITEMS_FOR_SHAPE - 1 }, () => item(true, 1000))
    expect(sessionShape(items, 60_000)).toBeNull()
  })
})

describe('velocity', () => {
  it('reports items per minute', () => {
    const items = Array.from({ length: 12 }, () => item(true, 1000))
    expect(sessionShape(items, 120_000)!.itemsPerMinute).toBeCloseTo(6, 5)
  })

  it('returns null velocity for a zero duration rather than dividing by zero', () => {
    const items = Array.from({ length: 6 }, () => item(true, 1000))
    expect(sessionShape(items, 0)!.itemsPerMinute).toBeNull()
  })
})

describe('fatigue', () => {
  it('flags a session that degrades and slows across its thirds', () => {
    const items = [
      item(true, 1000), item(true, 1000),
      item(true, 1500), item(false, 1500),
      item(false, 3000), item(false, 3000),
    ]
    const shape = sessionShape(items, 60_000)!
    expect(shape.accuracyDelta).toBeLessThan(0)
    expect(shape.latencyRatio).toBeGreaterThan(1)
    expect(shape.fatigued).toBe(true)
  })

  it('does not flag a steady session', () => {
    const items = Array.from({ length: 9 }, () => item(true, 1000))
    const shape = sessionShape(items, 60_000)!
    expect(shape.accuracyDelta).toBeCloseTo(0, 5)
    expect(shape.fatigued).toBe(false)
  })

  it('does not flag a session with accuracy decline but no latency increase', () => {
    const items = [
      item(true, 1000), item(true, 1000),
      item(false, 1000), item(false, 1000),
      item(false, 1000), item(false, 1000),
    ]
    const shape = sessionShape(items, 60_000)!
    expect(shape.accuracyDelta).toBeLessThan(0)
    expect(shape.latencyRatio).toBeLessThan(1.2)
    expect(shape.fatigued).toBe(false)
  })

  it('does not flag a session with latency increase but no accuracy decline', () => {
    const items = [
      item(true, 1000), item(true, 1000),
      item(true, 1500), item(true, 1500),
      item(true, 3000), item(true, 3000),
    ]
    const shape = sessionShape(items, 60_000)!
    expect(shape.accuracyDelta).toBeGreaterThan(-0.15)
    expect(shape.latencyRatio).toBeGreaterThan(1.2)
    expect(shape.fatigued).toBe(false)
  })
})

describe('third-size calculation', () => {
  it('correctly splits 7 items into thirds with floor not ceil', () => {
    // With 7 items: floor(7/3)=2, ceil(7/3)=3
    // Testing that floor is used, not ceil
    const items = [
      item(true, 1000), item(true, 1000),     // first 2
      item(true, 1500), item(false, 1500), item(false, 1500), // middle 3
      item(false, 2500), item(false, 2500),   // last 2
    ]
    const shape = sessionShape(items, 60_000)!
    // First third: [T, T] => accuracy 1.0
    // Last third: [F, F] => accuracy 0.0
    // accuracyDelta = 0.0 - 1.0 = -1.0
    expect(shape.accuracyDelta).toBeCloseTo(-1.0, 5)
    // If ceil was used: first [T,T,T]=1.0, last [F,F]=0.0, delta=-1.0
    // If floor used: first [T,T]=1.0, last [F,F]=0.0, delta=-1.0
    // Both give same result for this case, but the latency should differ
    // First third mean: (1000+1000)/2 = 1000
    // Last third mean: (2500+2500)/2 = 2500
    // Ratio: 2500/1000 = 2.5
    expect(shape.latencyRatio).toBeCloseTo(2.5, 5)
  })
})
