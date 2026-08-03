import { describe, it, expect } from 'vitest'
import { pickTfVariant } from '@/lib/quiz/coin-flip'

describe('pickTfVariant', () => {
  it('returns the real definition on a low roll', () => {
    expect(pickTfVariant(() => 0)).toBe('true')
    expect(pickTfVariant(() => 0.49)).toBe('true')
  })

  it('returns the corrupted statement on a high roll', () => {
    expect(pickTfVariant(() => 0.5)).toBe('false')
    expect(pickTfVariant(() => 0.99)).toBe('false')
  })

  it('is roughly balanced over many real draws', () => {
    const draws = Array.from({ length: 2000 }, () => pickTfVariant())
    const trues = draws.filter((d) => d === 'true').length
    expect(trues).toBeGreaterThan(800)
    expect(trues).toBeLessThan(1200)
  })
})
