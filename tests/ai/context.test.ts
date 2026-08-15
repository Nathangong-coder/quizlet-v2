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

describe('the topic section survives a huge card section (Spec 3 §14, defect 2)', () => {
  const topic = (key: string) => ({
    key, name: key, color: null, klpCount: 3,
    knowledge: 0.42, verbosityIndex: 0, knowledgeGapTerseness: 0, readiness: 0.7,
  })

  /** A card section that ALONE overruns the whole budget. */
  const hugeCards = {
    setId: null, setTitle: null, fading: [], strong: [], starred: [],
    weak: Array.from({ length: 500 }, (_, i) => ({
      term: `some-very-long-finance-term-name-number-${i}`,
      confidence: 1, mastery: null, trend: 'declining' as const,
    })),
    recent: { byMode: [], graded: [], streakDays: 0 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  it('keeps a topic line when the card section overruns the budget', () => {
    // THE test for this fix. Before it, the card section was concatenated
    // first and capBlock truncated the tail, so the topic section was always
    // what died — and every fixture with a small card section passed anyway.
    const block = profileToPromptBlock({ cards: hugeCards, topics: [topic('valuation')] })

    expect(block).toContain('By topic:')
    expect(block).toContain('valuation')
    expect(block.length).toBeLessThanOrEqual(MAX_PROFILE_CHARS)
  })

  it('still respects the overall cap with both sections large', () => {
    const block = profileToPromptBlock({
      cards: hugeCards,
      topics: Array.from({ length: 200 }, (_, i) => topic(`topic-${i}`)),
    })
    expect(block.length).toBeLessThanOrEqual(MAX_PROFILE_CHARS)
    expect(block).toContain('By topic:')
  })

  it('truncates the card section at LINE granularity, which is coarse here', () => {
    // `capTo` cuts at LINE boundaries and the card section is a handful of
    // very long lines (the whole `weak` list is one), so truncating it is
    // nearly all-or-nothing. That is why the size of the reserve is not what
    // rescues the topics — the ORDER is. Pinned because a reader who assumes
    // otherwise will start tuning a number that changes nothing.
    const block = profileToPromptBlock({ cards: hugeCards, topics: [topic('valuation')] })
    const cardsOnly = block.split('\nBy topic:')[0]

    expect(cardsOnly.split('\n').every((line) => line.length > 0)).toBe(true)
    expect(block).toContain('By topic:')
  })

  it('caps the whole block when the TOPIC section alone overruns it', () => {
    // topicLines bounds the topic COUNT, never the length of their names, so a
    // learner with very long category names can overrun on topics alone. This
    // is the input that makes the outer cap more than defence in depth.
    const longName = 'a-really-quite-long-category-name-that-a-learner-typed'.repeat(6)
    const block = profileToPromptBlock({
      cards: hugeCards,
      topics: Array.from({ length: 8 }, (_, i) => topic(`${longName}-${i}`)),
    })
    expect(block.length).toBeLessThanOrEqual(MAX_PROFILE_CHARS)
  })

  it('keeps the topic section at EVERY card-section size, not just huge ones', () => {
    // The property, swept rather than sampled. A single fixture cannot pin
    // this: `capTo` cuts at line boundaries, so whether the topic section
    // survives depends on exactly where the card section's last newline falls
    // relative to the budget. One hand-picked size passes for the wrong
    // reason. Somewhere in this sweep the boundary lands such that reserving
    // the topic section's own length is the only thing that saves it.
    const topics = [topic('valuation')]
    for (let n = 60; n <= 90; n += 1) {
      const cards = {
        setId: null, setTitle: null, fading: [], strong: [], starred: [],
        weak: Array.from({ length: n }, (_, i) => ({
          term: `finance-term-${i}`, confidence: 1, mastery: null, trend: 'declining' as const,
        })),
        recent: { byMode: [], graded: [], streakDays: 0 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
      const block = profileToPromptBlock({ cards, topics })
      expect(block.length, `n=${n}`).toBeLessThanOrEqual(MAX_PROFILE_CHARS)
      // The topic LINE, not just the 'By topic:' header. At one size in this
      // sweep an unreserved card section leaves exactly enough room for the
      // header and then loses the line under it — a block that announces a
      // topic section and contains none.
      expect(block, `n=${n}`).toContain('- valuation: 42%')
    }
  })
})
