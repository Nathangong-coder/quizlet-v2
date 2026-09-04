import { describe, it, expect } from 'vitest'
import { validateKlpSet } from '@/lib/klp/validate'
import { MAX_KLPS_AUTHORED } from '@/lib/klp/authoring-config'

const k = (text: string) => ({ text })

describe('validateKlpSet', () => {
  it('flags a compound KLP that could half-fail', () => {
    const out = validateKlpSet([k('EBIT falls by 10 and net income falls by 6')], 'Walk me through it')
    expect(out.some((d) => d.rule === 'compound')).toBe(true)
  })

  /**
   * "and" inside a noun phrase is not a compound proposition. Flagging it
   * would train the author to avoid ordinary English.
   */
  it('does not flag "and" joining a noun phrase', () => {
    const out = validateKlpSet([k('Property, plant and equipment falls by 10')], 'Walk me through it')
    expect(out.some((d) => d.rule === 'compound')).toBe(false)
  })

  /**
   * `increases`/`decreases` are also plain nouns. The "is" here belongs to
   * the sentence's real subject ("The value"), not to "decreases" — the
   * segment after "and" opens directly on the verb-like word with no subject
   * of its own, so this is one proposition, not two.
   */
  it('does not flag "and" joining two objects of a shared verb', () => {
    const out = validateKlpSet(
      [k('The value is derived from both increases and decreases in operating cash flow')],
      'Walk me through it',
    )
    expect(out.some((d) => d.rule === 'compound')).toBe(false)
  })

  it('still flags a genuine compound KLP with a subject and verb on each side', () => {
    const out = validateKlpSet([k('EBIT falls by 10 and net income falls by 6')], 'Walk me through it')
    expect(out.some((d) => d.rule === 'compound')).toBe(true)
  })

  it('still does not flag "and" joining a noun phrase (property, plant and equipment)', () => {
    const out = validateKlpSet([k('Property, plant and equipment falls by 10')], 'Walk me through it')
    expect(out.some((d) => d.rule === 'compound')).toBe(false)
  })

  it('flags a KLP that merely restates the question', () => {
    const out = validateKlpSet([k('Walk me through a $10 depreciation')], 'Walk me through a $10 depreciation')
    expect(out.some((d) => d.rule === 'restatement')).toBe(true)
  })

  it('flags a set below the grain floor', () => {
    const out = validateKlpSet([k('a'), k('b')], 'q')
    expect(out.some((d) => d.rule === 'count')).toBe(true)
  })

  it('flags a set above the cap', () => {
    const out = validateKlpSet(
      Array.from({ length: MAX_KLPS_AUTHORED + 1 }, (_, i) => k(`point ${i}`)),
      'q',
    )
    expect(out.some((d) => d.rule === 'count')).toBe(true)
  })

  it('accepts a set exactly at the authored cap', () => {
    const out = validateKlpSet(
      Array.from({ length: MAX_KLPS_AUTHORED }, (_, i) => k(`Distinct proposition number ${i}`)),
      'Walk me through it',
    )
    expect(out.some((d) => d.rule === 'count')).toBe(false)
  })

  it('accepts a well-formed set of six', () => {
    const out = validateKlpSet(
      Array.from({ length: 6 }, (_, i) => k(`Distinct proposition number ${i}`)),
      'Walk me through it',
    )
    expect(out).toEqual([])
  })

  it('flags duplicate propositions', () => {
    const six = Array.from({ length: 5 }, (_, i) => k(`Proposition ${i}`))
    const out = validateKlpSet([...six, k('Proposition 0')], 'q')
    expect(out.some((d) => d.rule === 'duplicate')).toBe(true)
  })
})
