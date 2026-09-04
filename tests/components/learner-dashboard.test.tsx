// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

/**
 * Spec 3C §7. The rendering guarantees that fail silently if untested:
 *  - `ranked` renders in the order RECEIVED (3B already applied the strategy);
 *  - a null metric renders its insufficient-data state, never a zero;
 *  - copy quotes the LEARNER'S floor, never a literal 3;
 *  - each empty cause gets its own message, since one merged message sends
 *    half the learners to the wrong fix.
 */
afterEach(cleanup)

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import EmptyDashboard from '@/components/learner/EmptyDashboard'
import TopicMastery from '@/components/learner/TopicMastery'
import StudyNext, { type StudyNextRow } from '@/components/learner/StudyNext'
import { RetentionPanel, MisconceptionList } from '@/components/learner/RetentionPanel'
import type { EmptyCause } from '@/lib/metrics/coverage'
import type { LearnerTopicProfile } from '@/lib/memory/topic-profile'

function candidate(over: Partial<StudyNextRow> & { klpId: string }): StudyNextRow {
  return {
    topicKey: 'accounting',
    weight: 3,
    pKnown: 0.5,
    observations: 5,
    readiness: null,
    dueAt: null,
    score: 0.5,
    sufficient: true,
    ...over,
  }
}

function topic(over: Partial<LearnerTopicProfile> & { key: string }): LearnerTopicProfile {
  return {
    name: over.key,
    color: null,
    depth: null,
    parentKey: null,
    klpCount: 4,
    measuredKlpCount: 4,
    knowledge: 0.6,
    verbosityIndex: 0,
    knowledgeGapTerseness: 0,
    readiness: 0.7,
    ...over,
  }
}

describe('StudyNext renders ranked in the order RECEIVED', () => {
  // Deliberately NOT score-descending. A fixture already in score order cannot
  // catch a component that re-sorts — 3B lost that exact bet twice.
  const OUT_OF_SCORE_ORDER = [
    candidate({ klpId: 'k-low', text: 'first', score: 0.11 }),
    candidate({ klpId: 'k-high', text: 'second', score: 0.99 }),
    candidate({ klpId: 'k-mid', text: 'third', score: 0.55 }),
  ]

  function renderedOrder() {
    const list = screen.getByTestId('measured-candidates')
    return [...list.querySelectorAll('[data-klp-id]')].map((el) =>
      el.getAttribute('data-klp-id'),
    )
  }

  it('follows the array, not the score', () => {
    render(<StudyNext ranked={OUT_OF_SCORE_ORDER} strategy="balanced" floor={3} />)
    expect(renderedOrder()).toEqual(['k-low', 'k-high', 'k-mid'])
  })

  it('follows a REORDERED array too', () => {
    // The half that makes the assertion above mean something: if the component
    // sorted, both orders would render identically.
    render(
      <StudyNext
        ranked={[OUT_OF_SCORE_ORDER[2], OUT_OF_SCORE_ORDER[0], OUT_OF_SCORE_ORDER[1]]}
        strategy="balanced"
        floor={3}
      />,
    )
    expect(renderedOrder()).toEqual(['k-mid', 'k-low', 'k-high'])
  })

  it('renders the KLP proposition, not the words "Key point"', () => {
    // The whole reason this row exists. Before labels were threaded through,
    // every row rendered the literal fallback — and on a library where most
    // cards are uncategorized, that was the entire list.
    render(
      <StudyNext
        ranked={[
          candidate({
            klpId: 'k1',
            text: 'Depreciation is a non-cash charge added back on the cash flow statement',
            term: 'Depreciation',
            topicName: 'Accounting',
          }),
        ]}
        strategy="balanced"
        floor={3}
      />,
    )
    expect(screen.getByText(/Depreciation is a non-cash charge/)).toBeTruthy()
    expect(screen.queryByText('Key point')).toBeNull()
    // The card term and the topic both survive as context beside it.
    expect(screen.getByText('Depreciation')).toBeTruthy()
    expect(screen.getByText('Accounting')).toBeTruthy()
  })

  it('still renders something when a label could not be resolved', () => {
    // `candidateLabels` is built from the same rows as the candidates, but a
    // caller passing an unlabelled row must not render "undefined".
    render(
      <StudyNext
        ranked={[candidate({ klpId: 'k1', text: undefined, term: undefined })]}
        strategy="balanced"
        floor={3}
      />,
    )
    expect(screen.getByText('Key point')).toBeTruthy()
  })

  it('shows the answer count on UNMEASURED rows, which is what they are ordered by', () => {
    // An order whose sort key is hidden is not readable as an order.
    render(
      <StudyNext
        ranked={[
          candidate({ klpId: 'k1', text: 'two answers', sufficient: false, observations: 2 }),
          candidate({ klpId: 'k2', text: 'none yet', sufficient: false, observations: 0 }),
        ]}
        strategy="balanced"
        floor={3}
      />,
    )
    const list = within(screen.getByTestId('unmeasured-candidates'))
    expect(list.getByText('2 answers')).toBeTruthy()
    // Not "0 answers" — on a list that exists because these are unmeasured, a
    // zero reads as a score rather than a state.
    expect(list.getByText('No answers yet')).toBeTruthy()
  })

  it('withholds pKnown below the floor but shows it above', () => {
    // The floor's entire purpose: "50% known" beside a single answer states a
    // confidence the evidence cannot support.
    render(
      <StudyNext
        ranked={[candidate({ klpId: 'k1', sufficient: false, observations: 1, pKnown: 0.5 })]}
        strategy="balanced"
        floor={3}
      />,
    )
    expect(screen.queryByText(/% known/)).toBeNull()

    cleanup()
    render(
      <StudyNext
        ranked={[candidate({ klpId: 'k2', sufficient: true, observations: 9, pKnown: 0.5 })]}
        strategy="balanced"
        floor={3}
      />,
    )
    expect(screen.getByText(/50% known/)).toBeTruthy()
  })

  it('separates unmeasured candidates instead of interleaving them', () => {
    // On a thin corpus they are all tied at the prior; presenting that tie as a
    // ranking invents a recommendation.
    render(
      <StudyNext
        ranked={[
          candidate({ klpId: 'k-known', text: 'measured' }),
          candidate({ klpId: 'k-new', text: 'unmeasured', sufficient: false, observations: 0 }),
        ]}
        strategy="balanced"
        floor={3}
      />,
    )
    expect(within(screen.getByTestId('measured-candidates')).getByText('measured')).toBeTruthy()
    expect(within(screen.getByTestId('unmeasured-candidates')).getByText('unmeasured')).toBeTruthy()
  })

  it("quotes the learner's floor in the unmeasured caption, not a literal 3", () => {
    render(
      <StudyNext
        ranked={[candidate({ klpId: 'k1', sufficient: false, observations: 0 })]}
        strategy="balanced"
        floor={1}
      />,
    )
    expect(screen.getByText(/fewer than 1 answer each/)).toBeTruthy()
  })

  it('names the active strategy so the ordering is attributable', () => {
    render(<StudyNext ranked={OUT_OF_SCORE_ORDER} strategy="follow_forgetting" floor={3} />)
    expect(screen.getByText('Follow the forgetting curve')).toBeTruthy()
  })

  it('labels an uncategorized candidate as such rather than printing the sentinel', () => {
    render(
      <StudyNext
        ranked={[candidate({ klpId: 'kU', text: 'orphan', topicKey: '__uncategorized__' })]}
        strategy="balanced"
        floor={3}
      />,
    )
    expect(screen.getByText('Uncategorized')).toBeTruthy()
    expect(screen.queryByText('__uncategorized__')).toBeNull()
  })
})

describe('TopicMastery keeps null distinct from zero', () => {
  it('renders an unmeasured knowledge as "not measured", never 0%', () => {
    render(<TopicMastery topics={[topic({ key: 'valuation', knowledge: null })]} floor={3} />)
    expect(screen.getByText('not measured')).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('renders a genuine zero as 0%', () => {
    // The other half: without it the assertion above passes for a component
    // that renders nothing at all.
    render(<TopicMastery topics={[topic({ key: 'valuation', knowledge: 0, readiness: null })]} floor={3} />)
    expect(screen.getByText('0%')).toBeTruthy()
  })

  it('keeps knowledge and articulation on separate axes', () => {
    render(<TopicMastery topics={[topic({ key: 'v', knowledge: 0.8, readiness: 0.3 })]} floor={3} />)
    expect(screen.getByText('80%')).toBeTruthy()
    expect(screen.getByText('30%')).toBeTruthy()
  })

  it('labels a low-pKnown terse topic as a knowledge gap, not as calibrated', () => {
    // No articulation signal BECAUSE the learner does not know it is not the
    // same as well calibrated, and reading it as neutral routes them to
    // expression practice they do not need.
    render(
      <TopicMastery
        topics={[topic({ key: 'v', verbosityIndex: 0, knowledgeGapTerseness: 3 })]}
        floor={3}
      />,
    )
    expect(screen.getByText('Knowledge gap')).toBeTruthy()
    expect(screen.queryByText('Calibrated')).toBeNull()
  })

  it('carries the topic colour through', () => {
    render(<TopicMastery topics={[topic({ key: 'v', color: '#ff0000' })]} floor={3} />)
    expect(screen.getByTestId('topic-color-v')).toBeTruthy()
  })

  it("states the learner's own floor in the description", () => {
    render(<TopicMastery topics={[topic({ key: 'v' })]} floor={1} />)
    expect(screen.getByText(/once 1 answer have landed|once 1 answer/)).toBeTruthy()
  })
})

describe('TopicMastery breadcrumb (Task 8)', () => {
  it('renders the ancestor path under the topic name when supplied', () => {
    render(
      <TopicMastery
        topics={[topic({ key: 'dcf', name: 'DCF' })]}
        floor={3}
        breadcrumbs={{ dcf: ['Finance', 'Valuation'] }}
      />,
    )
    expect(screen.getByText('Finance › Valuation')).toBeTruthy()
  })

  it('renders nothing extra for a topic with an empty breadcrumb (a root topic)', () => {
    render(
      <TopicMastery
        topics={[topic({ key: 'finance', name: 'Finance' })]}
        floor={3}
        breadcrumbs={{ finance: [] }}
      />,
    )
    // A depth-0 topic has no ancestors — the breadcrumb element itself must
    // not render at all, not render empty.
    expect(screen.queryByTestId('topic-breadcrumb-finance')).toBeNull()
  })

  it('leaves the category axis unaffected when no breadcrumbs prop is passed', () => {
    // The category axis call site never passes `breadcrumbs` — this is the
    // guard that a missing prop does not throw or render a stray breadcrumb.
    render(<TopicMastery topics={[topic({ key: 'accounting', name: 'Accounting' })]} floor={3} />)
    expect(screen.getByText('Accounting')).toBeTruthy()
    expect(screen.queryByTestId('topic-breadcrumb-accounting')).toBeNull()
  })
})

describe('EmptyDashboard names WHICH cause', () => {
  const CASES: { cause: EmptyCause; expect: RegExp }[] = [
    { cause: { kind: 'no_klps', blocking: true, pendingExtraction: 0 }, expect: /no key points yet/i },
    { cause: { kind: 'scope_too_narrow', blocking: true }, expect: /Nothing in your study scope/i },
    { cause: { kind: 'no_history', blocking: true }, expect: /Nothing to report yet/i },
    { cause: { kind: 'below_floor', blocking: false, measured: 4, floor: 3 }, expect: /Not enough evidence/i },
    { cause: { kind: 'nothing_categorized', blocking: false, cardsWithLiveKlps: 68 }, expect: /No topics yet/i },
  ]

  it('gives each of the five causes its own message', () => {
    // One merged message would send half the learners to the wrong fix: both
    // scope_too_narrow and nothing_categorized read as "nothing is here" while
    // the remedies are opposite.
    for (const c of CASES) {
      cleanup()
      render(<EmptyDashboard cause={c.cause} />)
      expect(screen.getByText(c.expect)).toBeTruthy()
    }
  })

  it("quotes the learner's floor, and never a literal 3", () => {
    render(<EmptyDashboard cause={{ kind: 'below_floor', blocking: false, measured: 9, floor: 1 }} />)
    expect(screen.getByText(/your evidence floor of 1 answer/)).toBeTruthy()
    expect(screen.queryByText(/floor of 3/)).toBeNull()
  })

  it('tells the learner extraction is pending rather than telling them to act', () => {
    render(<EmptyDashboard cause={{ kind: 'no_klps', blocking: true, pendingExtraction: 7 }} />)
    expect(screen.getByText(/7 cards are still being read/)).toBeTruthy()
  })

  it('says categorizing is retroactive, because nobody would guess it', () => {
    render(
      <EmptyDashboard cause={{ kind: 'nothing_categorized', blocking: false, cardsWithLiveKlps: 68 }} />,
    )
    expect(screen.getByText(/retroactively/)).toBeTruthy()
    expect(screen.getByText(/68 of your cards/)).toBeTruthy()
  })
})

describe('Retention and misconceptions', () => {
  it('shows each recall bucket WITH its sample size', () => {
    // A bucket built from two pairs must not look as authoritative as one built
    // from forty.
    render(
      <RetentionPanel
        forgetting={{
          buckets: [{ label: '0-1d', centerDays: 0.5, recallRate: 0.9, total: 2 }],
          halfLifeDays: null,
        }}
        paceOutliers={[]}
      />,
    )
    expect(screen.getByText(/\(2\)/)).toBeTruthy()
    expect(screen.getByText(/Half-life needs a bucket on each side/)).toBeTruthy()
  })

  it('labels each pace outlier with its mode', () => {
    // Each is scored against that mode's own baseline, so a figure without its
    // mode is not comparable to the one beside it.
    render(
      <RetentionPanel
        forgetting={null}
        paceOutliers={[{ cardId: 'c1', mode: 'quiz-sa', index: 2.4, term: 'WACC' }]}
      />,
    )
    expect(screen.getByText('Short Answer')).toBeTruthy()
    expect(screen.getByText(/2\.4× your usual/)).toBeTruthy()
  })

  it('keeps a retired misconception visible with its reason', () => {
    // One that silently disappears reads as a bug, not as progress.
    render(
      <MisconceptionList
        misconceptions={[
          {
            klpId: 'a', secondaryKlpId: 'b', occurrences: 3, sessionCount: 2,
            lastSeenAt: new Date(), evidenceSnippet: 'they are the same thing',
            active: false, retiredReason: 'cleared', label: 'FIFO vs LIFO',
          },
        ]}
      />,
    )
    expect(screen.getByText('FIFO vs LIFO')).toBeTruthy()
    expect(screen.getByText('Cleared')).toBeTruthy()
    expect(screen.getByText(/they are the same thing/)).toBeTruthy()
  })
})

describe('StudyNext prefers the short label over the proposition', () => {
  const PROPOSITION =
    'Taking on excessive debt increases financial distress and bankruptcy risk, driving debt holders to demand higher interest rates.'

  it('renders the label as the row, not the full proposition', () => {
    // The wall-of-sentences problem the KLT layer exists to fix. A ranked list
    // of twelve 16-word propositions is not a shortlist.
    render(
      <StudyNext
        ranked={[
          candidate({
            klpId: 'k1',
            label: 'Bankruptcy risk raises debt cost',
            text: PROPOSITION,
            term: 'Cost of debt',
          }),
        ]}
        strategy="balanced"
        floor={3}
      />,
    )
    expect(screen.getByText('Bankruptcy risk raises debt cost')).toBeTruthy()
    expect(screen.queryByText(PROPOSITION)).toBeNull()
  })

  it('falls back to the proposition when the label is null', () => {
    // Summarization is never a hard dependency of the study list.
    render(
      <StudyNext
        ranked={[candidate({ klpId: 'k1', label: null, text: PROPOSITION, term: 'Cost of debt' })]}
        strategy="balanced"
        floor={3}
      />,
    )
    expect(screen.getByText(PROPOSITION)).toBeTruthy()
  })
})
