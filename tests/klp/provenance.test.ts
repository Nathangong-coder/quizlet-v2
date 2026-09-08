import { describe, it, expect } from 'vitest'
import { authoredVersionKeys, classifyProvenance, cardProvenance } from '@/lib/klp/provenance'

describe('classifyProvenance', () => {
  const keys = authoredVersionKeys([{ cardId: 'c1', klpVersion: 3 }])

  it('is authored only when the run matches the KLP VERSION, not just the card', () => {
    expect(classifyProvenance({ cardId: 'c1', version: 3, promptVersion: 2 }, keys)).toBe('authored')
    // Same card, different version — a card authored once then re-extracted by
    // the legacy path. Matching on cardId alone would credit the pipeline with
    // key points it never wrote.
    expect(classifyProvenance({ cardId: 'c1', version: 4, promptVersion: 1 }, keys)).toBe('legacy')
  })

  it('is reused when there is no run at this version but the prompt version is >= 2', () => {
    expect(classifyProvenance({ cardId: 'c2', version: 1, promptVersion: 2 }, keys)).toBe('reused')
    expect(classifyProvenance({ cardId: 'c2', version: 1, promptVersion: 5 }, keys)).toBe('reused')
  })

  it('is legacy for the single-pass extractor', () => {
    expect(classifyProvenance({ cardId: 'c3', version: 1, promptVersion: 1 }, keys)).toBe('legacy')
  })
})

describe('cardProvenance', () => {
  it('is the provenance of a uniform set', () => {
    expect(cardProvenance(['authored', 'authored'])).toBe('authored')
    expect(cardProvenance(['reused', 'reused'])).toBe('reused')
    expect(cardProvenance(['legacy'])).toBe('legacy')
  })

  it('takes the WEAKEST provenance on a mixed card, never the strongest', () => {
    // The direction matters: reporting a mixed card as authored would credit
    // the pipeline for a set it did not fully write, which is the error that
    // flatters the thing being measured.
    expect(cardProvenance(['authored', 'legacy'])).toBe('legacy')
    expect(cardProvenance(['authored', 'reused'])).toBe('reused')
    expect(cardProvenance(['reused', 'legacy'])).toBe('legacy')
  })

  it('treats a card with no live KLPs as legacy rather than throwing', () => {
    expect(cardProvenance([])).toBe('legacy')
  })
})
