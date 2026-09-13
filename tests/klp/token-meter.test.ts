import { describe, it, expect } from 'vitest'
import { TokenMeter, MODEL_RATES, isDeepSeekPeak } from '@/lib/klp/token-meter'

describe('TokenMeter', () => {
  it('accumulates per step x model and prices at list, cache hits at the cached rate', () => {
    const m = new TokenMeter()
    m.add('grade', 'deepseek-v4-flash', { inputTokens: 1000, outputTokens: 500, cachedTokens: 200 })
    m.add('grade', 'deepseek-v4-flash', { inputTokens: 1000, outputTokens: 500 })
    m.add('author', 'glm-5.3-flash', { inputTokens: 2000, outputTokens: 3000, reasoningTokens: 1000 })
    const rows = m.rows()
    expect(rows.map((r) => `${r.step}/${r.model}/${r.calls}`)).toEqual(['author/glm-5.3-flash/1', 'grade/deepseek-v4-flash/2'])
    const peak = new Date('2026-09-14T02:00:00Z') // Monday 02:00 UTC
    const r = MODEL_RATES['deepseek-v4-flash']
    const expected = ((2000 - 200) * r.input + 200 * r.cachedInput + 1000 * r.output) / 1e6
    expect(TokenMeter.cost(rows[1], peak)).toBeCloseTo(expected, 8)
    // off-peak halves DeepSeek only
    expect(TokenMeter.cost(rows[1], new Date('2026-09-13T06:00:00Z'))).toBeCloseTo(expected / 2, 8)
    const g = MODEL_RATES['glm-5.3-flash']
    expect(TokenMeter.cost(rows[0], new Date('2026-09-13T06:00:00Z'))).toBeCloseTo((2000 * g.input + 3000 * g.output) / 1e6, 8)
  })

  it('reasoning is reported beside output, never added to it twice', () => {
    const m = new TokenMeter()
    m.add('author', 'glm-5.3-flash', { inputTokens: 0, outputTokens: 1000, reasoningTokens: 900 })
    const g = MODEL_RATES['glm-5.3-flash']
    expect(TokenMeter.cost(m.rows()[0])).toBeCloseTo((1000 * g.output) / 1e6, 8)
  })

  it('an unpriced model is shown as n/a and flagged in the total, not silently zero', () => {
    const m = new TokenMeter()
    m.add('grade', 'mystery-model', { inputTokens: 10, outputTokens: 10 })
    const out = m.format(1)
    expect(out).toContain('n/a')
    expect(out).toContain('unpriced')
  })

  it('DeepSeek peak window is Mon-Fri 01-04 and 06-10 UTC', () => {
    expect(isDeepSeekPeak(new Date('2026-09-14T01:30:00Z'))).toBe(true)
    expect(isDeepSeekPeak(new Date('2026-09-14T05:00:00Z'))).toBe(false)
    expect(isDeepSeekPeak(new Date('2026-09-14T09:59:00Z'))).toBe(true)
    expect(isDeepSeekPeak(new Date('2026-09-13T02:00:00Z'))).toBe(false) // Sunday
  })
})
