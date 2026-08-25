import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B6: readiness's numerator and denominator disagreed about their population.
 *
 * The denominator (`loadAnalyzedAnswerCounts`) counts only answers with
 * `analysisStatus: 'analyzed'`. The numerator — the `answerErrorTag` query —
 * had no such filter, and `buildAnalysisWrites` still writes whole-answer
 * clarity/conciseness tags under `no_klps` and `no_provenance`. So a topic
 * whose cards have no key points yet contributed expression weight with no
 * matching answer in the denominator: readiness read far worse than reality
 * and could pin to 0.
 *
 * Asserted against the `where` actually issued, because that is where the fix
 * lives — `shapeTopicProfile` never sees `analysisStatus` and cannot filter on
 * it. Same DB-mocking pattern as tests/memory/profile-scope.test.ts.
 */
const h = vi.hoisted(() => ({
  tagFindMany: vi.fn(),
  answerFindMany: vi.fn(),
  klpStateFindMany: vi.fn(),
  klpResultFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  attemptFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
  kltFindMany: vi.fn(),
  progressFindMany: vi.fn(),
  cardFindMany: vi.fn(),
  setFindUnique: vi.fn(),
  // `buildLearnerProfile` looks up a single-set scope's title through
  // findFirst (readability-guarded). Only reached once a test scopes to one
  // set, which nothing here did before Task 4B.
  setFindFirst: vi.fn(),
  tuningFindUnique: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    answerErrorTag: { findMany: h.tagFindMany },
    quizAnswer: { findMany: h.answerFindMany },
    klpState: { findMany: h.klpStateFindMany },
    answerKlpResult: { findMany: h.klpResultFindMany },
    studyEvent: { findMany: h.eventFindMany },
    quizAttempt: { findMany: h.attemptFindMany },
    cardCategory: { findMany: h.categoryFindMany },
    // The KLT axis. Empty by default: these suites are about the CATEGORY
    // axis, and `getLearnerMetrics` short-circuits `kltTopics` to [] when no
    // topic rows come back, so no further KLT query is reached.
    klt: { findMany: h.kltFindMany },
    cardProgress: { findMany: h.progressFindMany },
    card: { findMany: h.cardFindMany },
    set: { findUnique: h.setFindUnique, findFirst: h.setFindFirst },
    learnerTuning: { findUnique: h.tuningFindUnique },
  },
}))

import { getLearnerMetrics } from '@/lib/metrics/read'
import { EMPTY_SCOPE } from '@/lib/memory/scope'
import { resolveBands } from '@/lib/tuning/schema'

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of [
    h.tagFindMany, h.answerFindMany, h.klpStateFindMany, h.klpResultFindMany,
    h.eventFindMany, h.attemptFindMany, h.categoryFindMany, h.progressFindMany,
    h.cardFindMany,
  ]) {
    fn.mockResolvedValue([])
  }
  h.setFindUnique.mockResolvedValue(null)
  h.setFindFirst.mockResolvedValue(null)
  h.tuningFindUnique.mockResolvedValue(null)
  // One category holding two LIVE klps and one retired one, so the
  // live-only assertion below has something to catch.
  h.kltFindMany.mockResolvedValue([])
  h.categoryFindMany.mockResolvedValue([{
    normalizedName: 'valuation',
    name: 'Valuation',
    color: null,
    assignments: [{
      card: {
        id: 'cardA',
        klps: [
          { id: 'k1', supersededAt: null, weight: 5, cardId: 'cardA' },
          { id: 'k2', supersededAt: null, weight: 2, cardId: 'cardA' },
          { id: 'k-retired', supersededAt: new Date('2026-07-01T00:00:00Z'), weight: 4, cardId: 'cardA' },
        ],
      },
    }],
  }])
})

describe('readiness populations must agree (B6)', () => {
  it('excludes tags from answers whose analysis did not run', async () => {
    await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })

    const where = h.tagFindMany.mock.calls[0][0].where
    expect(where.quizAnswer.analysisStatus).toBe('analyzed')
  })

  it('draws both halves from the same scope fragment', async () => {
    // The numerator adds analysisStatus; everything else about the population
    // must still come from the one tested scope builder, or the two halves can
    // drift apart again in a different dimension.
    await getLearnerMetrics({
      userId: 'u1',
      scope: { ...EMPTY_SCOPE, cardId: 'c1' },
    })

    const numerator = h.tagFindMany.mock.calls[0][0].where.quizAnswer
    const denominator = h.answerFindMany.mock.calls[0][0].where

    expect(numerator.userId).toBe('u1')
    expect(numerator.cardId).toBe('c1')
    expect(denominator.cardId).toBe('c1')
    expect(denominator.analysisStatus).toBe('analyzed')
  })
})

describe('superseded KLPs reach tag attribution (B7)', () => {
  it('loads retired KLPs too, so a historical tag can still find its topic', async () => {
    await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })

    const select = h.categoryFindMany.mock.calls[0][0].select
    const klps = select.assignments.select.card.select.klps
    // Previously `where: { supersededAt: null }` — which dropped every tag on
    // an edited card out of the numerator while its answers stayed in the
    // denominator. The live/superseded split now happens in `toTopicRows`,
    // where knowledge keeps using live-only ids.
    expect(klps.where).toBeUndefined()
    expect(klps.select.supersededAt).toBe(true)
  })
})

describe('tuning is threaded all the way down (Spec 3B)', () => {
  it("reads the signed-in user's tuning row, scoped to them", async () => {
    await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })
    expect(h.tuningFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    )
  })

  it("applies the user's observation floor to topic knowledge", async () => {
    // One KLP, one observation. At the shipped floor of 3 this reports null;
    // the user has lowered it to 1, so it must report a number. If this fails,
    // `thresholds` stopped being forwarded into shapeTopicProfile.
    h.tuningFindUnique.mockResolvedValue({
      strategy: 'balanced', bands: null, thresholds: { minObservations: 1 },
    })
    h.klpStateFindMany.mockResolvedValue([{ klpId: 'k1', pKnown: 0.8, observations: 1 }])

    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })
    expect(out.profile.topics[0].knowledge).toBeCloseTo(0.8)
  })

  it('leaves that same knowledge null at the shipped floor', async () => {
    // The other half of the knob: without it the assertion above could pass
    // for reasons unrelated to tuning.
    h.klpStateFindMany.mockResolvedValue([{ klpId: 'k1', pKnown: 0.8, observations: 1 }])
    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })
    expect(out.profile.topics[0].knowledge).toBeNull()
  })

  it("ranks candidates under the user's stored strategy", async () => {
    // Two candidates that the strategies DISAGREE about, which is the whole
    // point of the assertion: `k-due` is well known, peripheral and overdue;
    // `k-weak` is unknown, central and not due. shore_up puts the unknown one
    // first, follow_forgetting the overdue one, and balanced agrees with
    // neither ordering by accident. A fixture the strategies happen to rank
    // identically cannot fail if the stored strategy is ignored.
    const NOW = new Date('2026-08-12T12:00:00.000Z')
    h.categoryFindMany.mockResolvedValue([
      {
        normalizedName: 'valuation', name: 'Valuation', color: null,
        assignments: [{ card: { id: 'cardA', klps: [{ id: 'k-due', supersededAt: null, weight: 1, cardId: 'cardA' }] } }],
      },
      {
        normalizedName: 'accounting', name: 'Accounting', color: null,
        assignments: [{ card: { id: 'cardB', klps: [{ id: 'k-weak', supersededAt: null, weight: 5, cardId: 'cardB' }] } }],
      },
    ])
    h.klpStateFindMany.mockResolvedValue([
      { klpId: 'k-due', pKnown: 0.9, observations: 5 },
      { klpId: 'k-weak', pKnown: 0.0, observations: 5 },
    ])
    h.progressFindMany.mockImplementation((args: { select?: Record<string, unknown> }) =>
      Promise.resolve(
        args?.select?.card
          ? []
          : [{ cardId: 'cardA', dueAt: new Date('2026-08-08T12:00:00.000Z') }],
      ),
    )

    h.tuningFindUnique.mockResolvedValue({
      strategy: 'shore_up_weaknesses', bands: null, thresholds: { minObservations: 1 },
    })
    const weaknessFirst = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE, now: NOW })
    expect(weaknessFirst.ranked.map((r) => r.klpId)[0]).toBe('k-weak')

    h.tuningFindUnique.mockResolvedValue({
      strategy: 'follow_forgetting', bands: null, thresholds: { minObservations: 1 },
    })
    const dueFirst = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE, now: NOW })
    expect(dueFirst.ranked.map((r) => r.klpId)[0]).toBe('k-due')
  })

  it('builds candidates from LIVE klp ids only — a superseded KLP is not a study target', async () => {
    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })
    expect(out.ranked.map((r) => r.klpId)).toContain('k1')
    expect(out.ranked.map((r) => r.klpId)).not.toContain('k-retired')
  })

  it("carries each KLP's stored weight and its card's due date into the candidate", async () => {
    // TWO callers now share `cardProgress.findMany` — buildLearnerProfile's
    // (which joins `card.term`) and Spec 3B's due-date query. Answering both
    // with one shape would feed profile.ts a row it cannot read, so key on the
    // select instead.
    // Both selects ask for `dueAt`; only buildLearnerProfile's joins the card.
    h.progressFindMany.mockImplementation((args: { select?: Record<string, unknown> }) =>
      Promise.resolve(
        args?.select?.card ? [] : [{ cardId: 'cardA', dueAt: new Date('2026-08-01T00:00:00Z') }],
      ),
    )
    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })
    const k1 = out.ranked.find((r) => r.klpId === 'k1')!
    expect(k1.weight).toBe(5)
    expect(k1.dueAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('lets an explicit bands argument override the stored one, for settings preview', async () => {
    h.tuningFindUnique.mockResolvedValue({
      strategy: 'balanced', bands: { inversion: [5, 5] }, thresholds: null,
    })
    // A caller-supplied table must win, so the panel can show "what would this
    // look like" without writing to the database first.
    const out = await getLearnerMetrics({
      userId: 'u1', scope: EMPTY_SCOPE, bands: resolveBands({ inversion: [1, 1] }),
    })
    expect(out).toBeDefined()
  })
})

describe('Uncategorized KLPs enter TARGETING but not topic mastery (Task 4B)', () => {
  const UNCATEGORIZED = '__uncategorized__'

  /** A card with live key points and no category assignment at all. */
  function uncategorizedCard() {
    h.cardFindMany.mockResolvedValue([
      { id: 'cardU', klps: [{ id: 'kU', weight: 4 }] },
    ])
  }

  it('ranks a KLP whose card has no category', async () => {
    // Before this, the walk started at CardCategory, so these KLPs were in no
    // topic and therefore in no candidate list — even with a real posterior.
    uncategorizedCard()
    h.klpStateFindMany.mockResolvedValue([
      { klpId: 'kU', pKnown: 0.2, observations: 5 },
    ])
    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })

    const candidate = out.ranked.find((c) => c.klpId === 'kU')
    expect(candidate).toBeDefined()
    expect(candidate!.topicKey).toBe(UNCATEGORIZED)
    // Its stored weight and posterior ride along like any other candidate's.
    expect(candidate!.weight).toBe(4)
    expect(candidate!.pKnown).toBeCloseTo(0.2)
    expect(candidate!.observations).toBe(5)
  })

  it('gives it NO topic-mastery row', async () => {
    // A grab-bag is not a concept. A knowledge rollup over it would invent one
    // and average across unrelated material.
    uncategorizedCard()
    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })

    expect(out.profile.topics.map((t) => t.key)).not.toContain(UNCATEGORIZED)
    expect(out.profile.topics.map((t) => t.key)).toEqual(['valuation'])
  })

  it('carries a null readiness — there is no topic to have measured', async () => {
    uncategorizedCard()
    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })
    expect(out.ranked.find((c) => c.klpId === 'kU')!.readiness).toBeNull()
  })

  it('is EXCLUDED when the scope names real categories', async () => {
    // The learner asked for those topics specifically.
    uncategorizedCard()
    const out = await getLearnerMetrics({
      userId: 'u1',
      scope: { ...EMPTY_SCOPE, categoryKeys: ['valuation'] },
    })
    expect(h.cardFindMany).not.toHaveBeenCalled()
    expect(out.ranked.map((c) => c.klpId)).not.toContain('kU')
  })

  it('is INCLUDED when the scope names the Uncategorized sentinel', async () => {
    uncategorizedCard()
    const out = await getLearnerMetrics({
      userId: 'u1',
      scope: { ...EMPTY_SCOPE, categoryKeys: [UNCATEGORIZED] },
    })
    expect(out.ranked.map((c) => c.klpId)).toContain('kU')
  })

  it('scopes the query to the owner and to live KLPs only', async () => {
    // Card has no userId of its own; ownership runs through the set. Without
    // this guard the ranked list can hand back another learner's propositions.
    uncategorizedCard()
    await getLearnerMetrics({ userId: 'u1', scope: { ...EMPTY_SCOPE, setIds: ['s1'] } })

    const [args] = h.cardFindMany.mock.calls[0]
    expect(args.where.set).toEqual({ userId: 'u1' })
    expect(args.where.categoryAssignments).toEqual({ none: {} })
    expect(args.where.klps).toEqual({ some: { supersededAt: null } })
    expect(args.where.setId).toEqual({ in: ['s1'] })
    expect(args.select.klps.where).toEqual({ supersededAt: null })
  })

  it('lets a card scope subsume the set scope', async () => {
    uncategorizedCard()
    await getLearnerMetrics({
      userId: 'u1',
      scope: { ...EMPTY_SCOPE, setIds: ['s1'], cardId: 'cardU' },
    })
    const [args] = h.cardFindMany.mock.calls[0]
    expect(args.where.id).toBe('cardU')
    expect(args.where).not.toHaveProperty('setId')
  })
})
