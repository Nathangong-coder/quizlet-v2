import { describe, it, expect } from 'vitest'
import { parseOptionCache, resolveDistractorProvenance } from '@/lib/quiz/options'

const v1 = { options: ['a', 'b', 'c', 'd'], correctAnswer: 'a' }

const v2 = {
  v: 2,
  correctAnswer: 'Market value weights',
  options: [
    { text: 'Market value weights', correct: true },
    { text: 'Book value weights', correct: false, sourceKlpId: 'klp-1', corruption: 'inversion' },
    { text: 'Equal weights', correct: false, sourceKlpId: 'klp-2', corruption: 'misapplication' },
    { text: 'Revenue weights', correct: false, sourceKlpId: 'klp-2', corruption: 'factual_error' },
  ],
}

describe('parseOptionCache', () => {
  it('reads a v2 blob with provenance intact', () => {
    const parsed = parseOptionCache(v2)!
    expect(parsed.version).toBe(2)
    expect(parsed.options[1].sourceKlpId).toBe('klp-1')
  })

  it('reads a legacy v1 blob as provenance-less', () => {
    // Every card already quizzed has one of these cached. Wiping them would
    // re-bill the user for generation they already paid for.
    const parsed = parseOptionCache(v1)!
    expect(parsed.version).toBe(1)
    expect(parsed.correctAnswer).toBe('a')
    expect(parsed.options).toHaveLength(4)
    expect(parsed.options[0].correct).toBe(true)
    expect(parsed.options[1].correct).toBe(false)
    expect(parsed.options.every((o) => o.sourceKlpId === undefined)).toBe(true)
  })

  it('returns null for a blob matching neither shape', () => {
    expect(parseOptionCache({ nonsense: true })).toBeNull()
    expect(parseOptionCache(null)).toBeNull()
  })

  it('rejects a v2 blob carrying an unknown corruption', () => {
    expect(
      parseOptionCache({
        ...v2,
        options: [{ text: 'x', correct: false, sourceKlpId: 'k', corruption: 'vibes' }],
      }),
    ).toBeNull()
  })
})

describe('resolveDistractorProvenance', () => {
  it('returns the corruption and source KLP of the picked distractor', () => {
    const parsed = parseOptionCache(v2)!
    expect(resolveDistractorProvenance(parsed, 'Book value weights')).toEqual({
      sourceKlpId: 'klp-1',
      corruption: 'inversion',
    })
  })

  it('returns null for the correct answer', () => {
    const parsed = parseOptionCache(v2)!
    expect(resolveDistractorProvenance(parsed, 'Market value weights')).toBeNull()
  })

  it('matches on trimmed, case-insensitive text', () => {
    // The client echoes back the rendered string; whitespace and casing must
    // not decide whether an answer is diagnosable.
    const parsed = parseOptionCache(v2)!
    expect(resolveDistractorProvenance(parsed, '  book VALUE weights ')).toEqual({
      sourceKlpId: 'klp-1',
      corruption: 'inversion',
    })
  })

  it('returns null on a v1 blob rather than inventing provenance', () => {
    const parsed = parseOptionCache(v1)!
    expect(resolveDistractorProvenance(parsed, 'b')).toBeNull()
  })

  it('returns null when the picked text matches no option', () => {
    const parsed = parseOptionCache(v2)!
    expect(resolveDistractorProvenance(parsed, 'something else entirely')).toBeNull()
  })
})
