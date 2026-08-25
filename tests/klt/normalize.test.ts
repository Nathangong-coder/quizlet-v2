import { describe, it, expect } from 'vitest'
import { normalizeKltName, parseKltName, MAX_KLT_WORDS, MAX_KLT_CHARS } from '@/lib/klt/normalize'

describe('normalizeKltName', () => {
  it('lowercases, trims and collapses internal whitespace', () => {
    expect(normalizeKltName('  Weighted   Average  Cost ')).toBe('weighted average cost')
  })

  it('strips surrounding punctuation and trailing periods', () => {
    expect(normalizeKltName('"WACC."')).toBe('wacc')
  })

  it('is idempotent — normalizing twice equals normalizing once', () => {
    const once = normalizeKltName('  Tax   Shield. ')
    expect(normalizeKltName(once)).toBe(once)
  })

  it('collapses the same concept written three ways to one key', () => {
    expect(normalizeKltName('WACC')).toBe(normalizeKltName('wacc'))
    expect(normalizeKltName('Tax Shield')).toBe(normalizeKltName('  tax  shield  '))
  })

  it('keeps hyphens — "after-tax" is one word, not two', () => {
    expect(normalizeKltName('After-Tax Cost')).toBe('after-tax cost')
  })

  it('pins golden vectors: the dedup key must not drift silently', () => {
    // Klt.normalizedName is GLOBALLY unique, so this function alone decides
    // whether two accounts' topics are the same node. A change here strands
    // every stored row, exactly like the api-key format vector.
    expect(normalizeKltName('WACC')).toBe('wacc')
    expect(normalizeKltName('Terminal Value')).toBe('terminal value')
    expect(normalizeKltName('Bankruptcy!')).toBe('bankruptcy')
    expect(normalizeKltName('Free  Cash   Flow')).toBe('free cash flow')
  })
})

describe('parseKltName', () => {
  it('keeps the display form while normalizing the key', () => {
    expect(parseKltName('Terminal Value')).toEqual({
      name: 'Terminal Value',
      normalizedName: 'terminal value',
    })
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(parseKltName('')).toBeNull()
    expect(parseKltName('   ')).toBeNull()
  })

  it(`rejects more than ${MAX_KLT_WORDS} words — a topic, not a sentence`, () => {
    expect(parseKltName('the weighted average cost of capital')).toBeNull()
    expect(parseKltName('weighted average cost capital')).not.toBeNull()
  })

  it(`rejects names longer than ${MAX_KLT_CHARS} characters`, () => {
    expect(parseKltName('a'.repeat(MAX_KLT_CHARS + 1))).toBeNull()
    expect(parseKltName('a'.repeat(MAX_KLT_CHARS))).not.toBeNull()
  })

  it('measures the caps against the NORMALIZED form, not the raw input', () => {
    // Padding must not push an otherwise valid name over a cap.
    expect(parseKltName(`   ${'a'.repeat(MAX_KLT_CHARS)}   `)).not.toBeNull()
  })

  it('rejects a name that is only punctuation', () => {
    expect(parseKltName('!!!')).toBeNull()
  })
})
