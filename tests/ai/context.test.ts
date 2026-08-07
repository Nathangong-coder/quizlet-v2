import { describe, it, expect } from 'vitest'
import { profileToPromptBlock, MAX_PROFILE_CHARS, MAX_TOPICS_IN_BLOCK } from '@/lib/ai/context'
import type { LearnerCardProfile } from '@/lib/memory/profile'

function emptyProfile(overrides: Partial<LearnerCardProfile> = {}): LearnerCardProfile {
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

/**
 * `profileToPromptBlock` now accepts the composite `LearnerProfile` (Task 17),
 * not the bare card-grain profile. This wraps a card-grain fixture with an
 * empty topics array so the pre-existing card-section assertions below keep
 * exercising the exact same rendering path unchanged.
 */
function render(cards: LearnerCardProfile): string {
  return profileToPromptBlock({ cards, topics: [] })
}

describe('empty-history default', () => {
  it('renders a header and a zero-streak Recent line without crashing, and omits empty buckets', () => {
    const block = render(emptyProfile())

    expect(block).toContain('Learner snapshot')
    expect(block).toContain('Recent:')
    expect(block).toContain('0-day streak')
    expect(block).not.toContain('Weak')
    expect(block).not.toContain('Fading')
    expect(block).not.toContain('Strong')
    expect(block).not.toContain('Starred')
  })

  it('omits the set suffix when setTitle is absent (profile spans all sets)', () => {
    const block = render(emptyProfile())
    expect(block.split('\n')[0]).not.toContain('set:')
  })

  it('includes the set title in the header when present', () => {
    const block = render(emptyProfile({ setId: 's1', setTitle: 'M&A Basics' }))
    expect(block.split('\n')[0]).toBe('Learner snapshot (set: "M&A Basics")')
  })
})

describe('rendering matches the brief format', () => {
  it('renders weak terms with confidence and trend symbol', () => {
    const block = render(
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
    const block = render(
      emptyProfile({
        weak: [{ term: 'DCF', confidence: 4, mastery: null, trend: 'improving' }],
      }),
    )
    expect(block).toContain('"DCF" (4, ↑)')
  })

  it('renders fading terms with was-confidence and a pluralized miss count', () => {
    const block = render(
      emptyProfile({
        fading: [{ term: 'WACC', wasConfidence: 7, missCount: 2 }],
      }),
    )
    expect(block).toContain('Fading (due, slipping): "WACC" (was 7, missed twice this week)')
  })

  it('pluralizes miss count correctly for 1 and for 3+', () => {
    expect(
      render(emptyProfile({ fading: [{ term: 'X', wasConfidence: 5, missCount: 1 }] })),
    ).toContain('missed once this week')
    expect(
      render(emptyProfile({ fading: [{ term: 'X', wasConfidence: 5, missCount: 4 }] })),
    ).toContain('missed 4 times this week')
  })

  it('renders strong terms', () => {
    const block = render(
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
    const block = render(
      emptyProfile({ starred: [{ term: 'IRR', confidence: 6 }] }),
    )
    expect(block).toContain('Starred: "IRR" (6)')
  })

  it('renders per-mode accuracy, graded average, and streak in the Recent line', () => {
    const block = render(
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
    const block = render(
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

describe('renders a large profile without truncation', () => {
  // Task 17 introduced a global MAX_PROFILE_CHARS cap over the whole block
  // (cards + topics). A bucket this large (500 terms x a ~40-char name) is
  // now, by design, exactly the case the cap exists to catch — its own Weak
  // line alone runs to tens of thousands of characters, so this fixture is
  // sized to stay well under the 2000-char budget instead. That keeps this
  // test's original intent (buildCardSection itself imposes no per-bucket
  // truncation) provable without colliding with the new global cap, which
  // is covered separately below and in the Spec 3 describe block.
  it('includes every weak term for a moderately large weak bucket', () => {
    const profile = emptyProfile({
      weak: Array.from({ length: 20 }, (_, i) => ({
        term: `term-${i}`,
        confidence: 1,
        mastery: null,
        trend: 'declining' as const,
      })),
    })

    const block = render(profile)
    expect(block).toContain('term-0')
    expect(block).toContain('term-19')
  })

  it('caps the total block even when the card section alone is huge', () => {
    const hugeProfile = emptyProfile({
      weak: Array.from({ length: 500 }, (_, i) => ({
        term: `some-very-long-finance-term-name-number-${i}`,
        confidence: 1,
        mastery: null,
        trend: 'declining' as const,
      })),
    })

    const block = render(hugeProfile)
    expect(block.length).toBeLessThanOrEqual(MAX_PROFILE_CHARS)
  })
})

describe('Spec 3 profile block', () => {
  const topic = (key: string, knowledge: number | null, verbosity: number) => ({
    key, name: key, color: null, klpCount: 3,
    knowledge, verbosityIndex: verbosity, knowledgeGapTerseness: 0, readiness: 0.7,
  })

  const cards = { setId: null, setTitle: null, weak: [], fading: [], strong: [], starred: [],
    recent: { byMode: [], graded: [], streakDays: 0 } } as any

  it('never exceeds the character cap even with many topics', () => {
    const topics = Array.from({ length: 200 }, (_, i) => topic(`topic-${i}`, 0.4, 3))
    const block = profileToPromptBlock({ cards, topics })
    expect(block.length).toBeLessThanOrEqual(MAX_PROFILE_CHARS)
  })

  it('caps the number of rendered topics independent of the character budget', () => {
    // Short names/few topics so the char cap can't be what's limiting the
    // count here — isolates MAX_TOPICS_IN_BLOCK from MAX_PROFILE_CHARS.
    const topics = Array.from({ length: 20 }, (_, i) => topic(`t${i}`, i / 20, 0))
    const block = profileToPromptBlock({ cards, topics })
    const renderedTopicLines = block.split('\n').filter((line) => line.startsWith('- '))
    expect(renderedTopicLines.length).toBe(MAX_TOPICS_IN_BLOCK)
  })

  it('contains no cuids — the model sees text, never ids', () => {
    const block = profileToPromptBlock({ cards, topics: [topic('valuation', 0.4, 3)] })
    expect(block).not.toMatch(/c[a-z0-9]{24}/)
  })

  it('describes verbosity in both directions', () => {
    const over = profileToPromptBlock({ cards, topics: [topic('accounting', 0.8, 9)] })
    const under = profileToPromptBlock({ cards, topics: [topic('equity-value', 0.8, -9)] })
    expect(over).not.toBe(under)
  })

  it('omits a topic with null knowledge rather than calling it 0', () => {
    const block = profileToPromptBlock({ cards, topics: [topic('unknown-topic', null, 0)] })
    expect(block).not.toContain('0%')
  })

  it('truncates at a line boundary, never mid-line', () => {
    // Only 8 (== MAX_TOPICS_IN_BLOCK) topics ever render regardless of how
    // many are passed in, so each name must be long enough on its own that
    // 8 of them blow MAX_PROFILE_CHARS (2000) — ~300 chars/name x 8 well
    // exceeds it, guaranteeing the cutoff lands mid-line, not at a boundary.
    const topics = Array.from({ length: 8 }, (_, i) =>
      topic(`${'a-very-long-descriptive-topic-name-for-truncation-testing-'.repeat(6)}${i}`, i / 8, 0),
    )
    const expectedFullLines = new Set(
      topics.map((t) => `- ${t.name}: ${Math.round((t.knowledge as number) * 100)}%`),
    )

    const block = profileToPromptBlock({ cards, topics })
    const blockLines = block.split('\n').filter((l) => l.length > 0)
    const lastLine = blockLines[blockLines.length - 1]

    // The last rendered line must be a COMPLETE line — either a fully
    // rendered topic line or a structural line — never a partial fragment
    // of one, which mid-line truncation would produce.
    const isCompleteLine =
      expectedFullLines.has(lastLine) ||
      lastLine === 'By topic:' ||
      lastLine.startsWith('Learner snapshot') ||
      lastLine.startsWith('Recent:')
    expect(isCompleteLine).toBe(true)
  })

  it('orders topics weakest-first, with unknown (null) knowledge last', () => {
    const topics = [
      topic('strongest', 0.9, 0),
      topic('weakest', 0.2, 0),
      topic('no-data', null, 0),
      topic('middling', 0.5, 0),
    ]
    const block = profileToPromptBlock({ cards, topics })
    const topicLines = block
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).split(':')[0])

    expect(topicLines).toEqual(['weakest', 'middling', 'strongest', 'no-data'])
  })
})
