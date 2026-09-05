import { describe, it, expect } from 'vitest'
import { validateKlpSet, findOrderingDefects } from '@/lib/klp/validate'
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

describe('findOrderingDefects', () => {
  /**
   * `CardKlp.index` means DELIVERY ORDER since increment A §3, and a `precedes`
   * edge pointing backwards against it is a contradiction between two things
   * the same run produced — detectable with no extra AI call.
   */
  it('flags a precedes edge that points backwards against the stored order', () => {
    const out = findOrderingDefects([{ from: 3, to: 1, type: 'precedes' }])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ index: 3, rule: 'ordering' })
    expect(out[0].detail).toContain('must precede')
  })

  it('accepts a precedes edge that agrees with the stored order', () => {
    expect(findOrderingDefects([{ from: 1, to: 3, type: 'precedes' }])).toEqual([])
  })

  /**
   * Only `precedes` claims delivery order. `requires` and `causes` are
   * dependency claims — a strong answer may legitimately state a conclusion
   * before the mechanism producing it — so flagging those would manufacture
   * defects out of good answers.
   */
  it('ignores dependency edges, which say nothing about delivery order', () => {
    expect(
      findOrderingDefects([
        { from: 3, to: 1, type: 'requires' },
        { from: 4, to: 0, type: 'causes' },
        { from: 2, to: 0, type: 'confused_with' },
      ]),
    ).toEqual([])
  })

  it('reports every violation, not just the first', () => {
    expect(
      findOrderingDefects([
        { from: 3, to: 1, type: 'precedes' },
        { from: 4, to: 2, type: 'precedes' },
      ]),
    ).toHaveLength(2)
  })
})

describe('validateKlpSet ordering and sizing', () => {
  const enough = Array.from({ length: 4 }, (_, i) => k(`Distinct proposition number ${i}`))

  it('runs the ordering cross-check as part of the set validation', () => {
    const out = validateKlpSet(enough, 'q', { edges: [{ from: 3, to: 0, type: 'precedes' }] })
    expect(out.map((d) => d.rule)).toContain('ordering')
  })

  /** No graph means nothing to check against — not a clean bill of health. */
  it('reports no ordering defect when no edges are supplied', () => {
    expect(validateKlpSet(enough, 'q').map((d) => d.rule)).not.toContain('ordering')
  })

  /**
   * The count rule follows the card's ADAPTIVE target now, not a fixed range —
   * four KLPs is correct for a terse card and short for a card sized at six.
   */
  it('measures the count against the card\u2019s sized target', () => {
    expect(validateKlpSet(enough, 'q').map((d) => d.rule)).not.toContain('count')
    const short = validateKlpSet(enough, 'q', { targetCount: 6 })
    expect(short.map((d) => d.rule)).toContain('count')
    expect(short.find((d) => d.rule === 'count')?.detail).toContain('expected 6-')
  })

  /** A caller cannot ask for a target below the floor the owner set. */
  it('never lets a supplied target drop below MIN_KLPS_PER_CARD', () => {
    const out = validateKlpSet([k('only one point')], 'q', { targetCount: 1 })
    expect(out.map((d) => d.rule)).toContain('count')
  })
})
