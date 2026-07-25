import { describe, it, expect } from 'vitest'
import { profileToPromptBlock, MAX_PROMPT_BLOCK_CHARS } from '@/lib/ai/context'
import type { LearnerProfile } from '@/lib/memory/profile'

function emptyProfile(overrides: Partial<LearnerProfile> = {}): LearnerProfile {
  return {
    setId: null,
    setTitle: null,
    weak: [],
    fading: [],
    strong: [],
    starred: [],
    recent: { byMode: [], graded: [], streakDays: 0 },
    ...overrides,
  }
}

describe('empty-history default', () => {
  it('renders a header and a zero-streak Recent line without crashing, and omits empty buckets', () => {
    const block = profileToPromptBlock(emptyProfile())

    expect(block).toContain('Learner snapshot')
    expect(block).toContain('Recent:')
    expect(block).toContain('0-day streak')
    expect(block).not.toContain('Weak')
    expect(block).not.toContain('Fading')
    expect(block).not.toContain('Strong')
    expect(block).not.toContain('Starred')
  })

  it('omits the set suffix when setTitle is absent (profile spans all sets)', () => {
    const block = profileToPromptBlock(emptyProfile())
    expect(block.split('\n')[0]).not.toContain('set:')
  })

  it('includes the set title in the header when present', () => {
    const block = profileToPromptBlock(emptyProfile({ setId: 's1', setTitle: 'M&A Basics' }))
    expect(block.split('\n')[0]).toBe('Learner snapshot (set: "M&A Basics")')
  })
})

describe('rendering matches the brief format', () => {
  it('renders weak terms with confidence and trend symbol', () => {
    const block = profileToPromptBlock(
      emptyProfile({
        weak: [
          { term: 'accretion/dilution', confidence: 2, mastery: null, trend: 'declining' },
          { term: 'synergies', confidence: 3, mastery: null, trend: 'flat' },
        ],
      }),
    )
    expect(block).toContain('Weak (conf<=4): "accretion/dilution" (2, ↓), "synergies" (3, flat)')
  })

  it('renders an improving trend with an up arrow', () => {
    const block = profileToPromptBlock(
      emptyProfile({
        weak: [{ term: 'DCF', confidence: 4, mastery: null, trend: 'improving' }],
      }),
    )
    expect(block).toContain('"DCF" (4, ↑)')
  })

  it('renders fading terms with was-confidence and a pluralized miss count', () => {
    const block = profileToPromptBlock(
      emptyProfile({
        fading: [{ term: 'WACC', wasConfidence: 7, missCount: 2 }],
      }),
    )
    expect(block).toContain('Fading (due, slipping): "WACC" (was 7, missed twice this week)')
  })

  it('pluralizes miss count correctly for 1 and for 3+', () => {
    expect(
      profileToPromptBlock(emptyProfile({ fading: [{ term: 'X', wasConfidence: 5, missCount: 1 }] })),
    ).toContain('missed once this week')
    expect(
      profileToPromptBlock(emptyProfile({ fading: [{ term: 'X', wasConfidence: 5, missCount: 4 }] })),
    ).toContain('missed 4 times this week')
  })

  it('renders strong terms', () => {
    const block = profileToPromptBlock(
      emptyProfile({
        strong: [
          { term: 'EBITDA', confidence: 9 },
          { term: 'DCF', confidence: 8 },
        ],
      }),
    )
    expect(block).toContain('Strong: "EBITDA" (9), "DCF" (8)')
  })

  it('renders starred terms', () => {
    const block = profileToPromptBlock(
      emptyProfile({ starred: [{ term: 'IRR', confidence: 6 }] }),
    )
    expect(block).toContain('Starred: "IRR" (6)')
  })

  it('renders per-mode accuracy, graded average, and streak in the Recent line', () => {
    const block = profileToPromptBlock(
      emptyProfile({
        recent: {
          byMode: [{ mode: 'quiz-mc', accuracyPct: 72, count: 10 }],
          graded: [{ mode: 'quiz-sa', avgScoreOutOfTen: 6.1, count: 5 }],
          streakDays: 3,
        },
      }),
    )
    expect(block).toContain('Recent: MC 72% · short-answer avg 6.1/10 · 3-day streak')
  })
})

describe('never leaks raw IDs', () => {
  it('output text contains no cuid-shaped tokens', () => {
    const block = profileToPromptBlock(
      emptyProfile({
        setId: 'cklsjdf9820askjdf',
        setTitle: 'Finance',
        weak: [{ term: 'IRR', confidence: 2, mastery: null, trend: 'flat' }],
      }),
    )
    // The raw setId cuid must never appear in the rendered text, only setTitle.
    expect(block).not.toContain('cklsjdf9820askjdf')
  })
})

describe('token budget is enforced regardless of input shape', () => {
  it('hard-caps output length even for a pathologically large profile bypassing normal caps', () => {
    const hugeProfile = emptyProfile({
      weak: Array.from({ length: 500 }, (_, i) => ({
        term: `some-very-long-finance-term-name-number-${i}`,
        confidence: 1,
        mastery: null,
        trend: 'declining' as const,
      })),
    })

    const block = profileToPromptBlock(hugeProfile)
    expect(block.length).toBeLessThanOrEqual(MAX_PROMPT_BLOCK_CHARS)
  })
})
