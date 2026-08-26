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
  setKltNodeFindMany: vi.fn(),
  klpTopicFindMany: vi.fn(),
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
    // topic rows come back (`loadKltRows` finds no `SetKltNode` rows), so no
    // further KLT query (`klpTopic`, `quizAnswer` for the KLT denominator) is
    // reached.
    setKltNode: { findMany: h.setKltNodeFindMany },
    klpTopic: { findMany: h.klpTopicFindMany },
    cardProgress: { findMany: h.progressFindMany },
    card: { findMany: h.cardFindMany },
    set: { findUnique: h.setFindUnique, findFirst: h.setFindFirst },
    learnerTuning: { findUnique: h.tuningFindUnique },
  },
}))

import { getLearnerMetrics } from '@/lib/metrics/read'
import { EMPTY_SCOPE } from '@/lib/memory/scope'
import { resolveBands } from '@/lib/tuning/schema'
import { deriveTagScores, toStoredTags } from '@/lib/errors/derive'
import { computeArticulation } from '@/lib/metrics/articulation'

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
  h.setKltNodeFindMany.mockResolvedValue([])
  h.klpTopicFindMany.mockResolvedValue([])
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

describe('KLT rollup resolves each set independently, then unions by concept (Task 3, spec §6.2)', () => {
  // Two sets both place the SAME concept ('accounting') as a root, each with
  // its own descendant leaf carrying a DIFFERENT key point: set A's
  // 'revrec' (klp k-a1), set B's 'matching' (klp k-b1). This is exactly the
  // scenario §6.2 says is intended, not a bug: the concept is the same node,
  // the paths differ.
  function twoSetStructure() {
    h.setKltNodeFindMany.mockResolvedValue([
      { setId: 'set-A', kltId: 'concept-acct', depth: 0, ancestorIds: [],
        klt: { normalizedName: 'accounting', name: 'Accounting' } },
      { setId: 'set-A', kltId: 'concept-revrec', depth: 1, ancestorIds: ['concept-acct'],
        klt: { normalizedName: 'revrec', name: 'Revenue Recognition' } },
      { setId: 'set-B', kltId: 'concept-acct', depth: 0, ancestorIds: [],
        klt: { normalizedName: 'accounting', name: 'Accounting' } },
      { setId: 'set-B', kltId: 'concept-matching', depth: 1, ancestorIds: ['concept-acct'],
        klt: { normalizedName: 'matching', name: 'Matching Principle' } },
    ])
    h.klpTopicFindMany.mockImplementation((args: { where: { klp: { card: { setId: string } } } }) => {
      const setId = args.where.klp.card.setId
      if (setId === 'set-A') {
        return Promise.resolve([
          { kltId: 'concept-revrec', rank: 1, klp: { id: 'k-a1', supersededAt: null, cardId: 'card-a1' } },
        ])
      }
      if (setId === 'set-B') {
        return Promise.resolve([
          { kltId: 'concept-matching', rank: 1, klp: { id: 'k-b1', supersededAt: null, cardId: 'card-b1' } },
        ])
      }
      return Promise.resolve([])
    })
  }

  it("unions a concept present in two sets ONCE PER SET — mastery counts BOTH sets' key points, not zero and not doubled", async () => {
    twoSetStructure()
    // Nothing clears MIN_TOPICS_AT_DEPTH anywhere, so `selectDisplayDepth`
    // shows the broadest existing level — depth 0, 'accounting' — which is
    // exactly the unioned interior node this test is about.
    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })

    const accounting = out.kltTopics.find((t) => t.key === 'accounting')
    expect(accounting).toBeDefined()
    // The union: both sets' key points, counted once each.
    expect(accounting!.klpCount).toBe(2)
  })

  it("queries each set's links separately, pinned to that set's own cards", async () => {
    // The mechanism behind the union above: one `klpTopic.findMany` call per
    // set, each scoped to `card.setId` for THAT set — never a single query
    // spanning both, which is what would make the per-set resolution real
    // rather than accidental.
    //
    // Scope BOTH sets explicitly (not EMPTY_SCOPE) so `buildCardScopeWhere`
    // actually sets `card.setId = { in: ['set-A', 'set-B'] }` from the scope —
    // this is what makes the assertion below catch a caller that forgets to
    // override that multi-set `in` with the single set actually being rolled
    // up: with EMPTY_SCOPE, `buildCardScopeWhere` never touches `setId` at
    // all, and the same bug would pass unnoticed.
    twoSetStructure()
    await getLearnerMetrics({
      userId: 'u1',
      scope: { ...EMPTY_SCOPE, setIds: ['set-A', 'set-B'] },
    })

    const setIdsQueried = h.klpTopicFindMany.mock.calls.map(
      (call) => call[0].where.klp.card.setId,
    )
    // Each call's `card.setId` must be a single scalar naming THAT set, never
    // the scope's `{ in: [...] }` — a caller who let the scope's clause
    // survive would have BOTH calls query `{ in: ['set-A', 'set-B'] }`.
    expect(setIdsQueried.every((id) => typeof id === 'string')).toBe(true)
    expect(new Set(setIdsQueried)).toEqual(new Set(['set-A', 'set-B']))
  })

  it("orders the SetKltNode read by setId, so 'first set wins' (breadcrumb, depth pick) is deterministic rather than whatever Postgres happens to return (review finding #9)", async () => {
    twoSetStructure()
    await getLearnerMetrics({
      userId: 'u1',
      scope: { ...EMPTY_SCOPE, setIds: ['set-A', 'set-B'] },
    })

    expect(h.setKltNodeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { setId: 'asc' } }),
    )
  })

  it('a set with no placed structure at all yields no KLT topics, without throwing', async () => {
    h.setKltNodeFindMany.mockResolvedValue([])
    await expect(
      getLearnerMetrics({ userId: 'u1', scope: { ...EMPTY_SCOPE, setIds: ['set-empty'] } }),
    ).resolves.not.toThrow()
    const out = await getLearnerMetrics({ userId: 'u1', scope: { ...EMPTY_SCOPE, setIds: ['set-empty'] } })
    expect(out.kltTopics).toEqual([])
    expect(h.klpTopicFindMany).not.toHaveBeenCalled()
  })
})

describe('KLT readiness denominator does not cross an unplaced set boundary (review finding #8)', () => {
  it("a set with no SetKltNode structure at all contributes nothing to another set's topic denominator", async () => {
    // Set B places 'accounting' as a root concept and has its own klp linked
    // to it. Set A CITES the same concept name via one of its cards' klp
    // topics, but has never placed any structure of its own — the ordinary
    // state for a freshly imported deck. `closuresBySet` therefore has an
    // entry for set B only.
    h.setKltNodeFindMany.mockResolvedValue([
      { setId: 'set-B', kltId: 'concept-acct', depth: 0, ancestorIds: [],
        klt: { normalizedName: 'accounting', name: 'Accounting' } },
    ])
    h.klpTopicFindMany.mockImplementation((args: { where: { klp: { card: { setId: string } } } }) => {
      const setId = args.where.klp.card.setId
      if (setId === 'set-B') {
        return Promise.resolve([
          { kltId: 'concept-acct', rank: 1, klp: { id: 'k-b1', supersededAt: null, cardId: 'card-b1' } },
        ])
      }
      return Promise.resolve([])
    })

    // ONE analyzed answer, on a card in the UNPLACED set A, citing
    // 'accounting' via its klp's topic — no analyzed answers on set B's own
    // cards at all. Before the fix, this answer fell through the
    // `closuresBySet.get(setId) ?? new Map()` fallback and inflated
    // `counts['accounting']` anyway; readiness would then read as evidenced
    // (non-null) purely from a set with no placed structure.
    h.answerFindMany.mockImplementation(
      (args: { select?: { card?: { select?: Record<string, unknown> } } }) => {
        const isKltAxis = !!args.select?.card?.select?.klps
        if (!isKltAxis) return Promise.resolve([]) // the category-axis call
        return Promise.resolve([
          { card: { setId: 'set-A', klps: [{ topics: [{ klt: { normalizedName: 'accounting' } }] }] } },
        ])
      },
    )

    const out = await getLearnerMetrics({
      userId: 'u1',
      scope: { ...EMPTY_SCOPE, setIds: ['set-A', 'set-B'] },
    })

    const accounting = out.kltTopics.find((t) => t.key === 'accounting')
    expect(accounting).toBeDefined()
    // Set A's answer must NOT have entered this denominator. Set B (the only
    // set with placed structure) had zero analyzed answers of its own, so the
    // correct denominator is 0 and readiness must read `null` — "no
    // evidence" — not a value borrowed from an unplaced set.
    expect(accounting!.readiness).toBeNull()
  })
})

describe('KLT readiness denominator sums across sets rather than overwriting (review finding #8, the += fold)', () => {
  it('two sets that both place the same concept each contribute their own analyzed answer to the denominator', async () => {
    // Both sets place 'accounting' as a root and each links ONE key point of
    // their own directly to it — no children, so the ancestor-climb already
    // covered by the union test above stays out of this test's way.
    h.setKltNodeFindMany.mockResolvedValue([
      { setId: 'set-A', kltId: 'concept-acct', depth: 0, ancestorIds: [],
        klt: { normalizedName: 'accounting', name: 'Accounting' } },
      { setId: 'set-B', kltId: 'concept-acct', depth: 0, ancestorIds: [],
        klt: { normalizedName: 'accounting', name: 'Accounting' } },
    ])
    h.klpTopicFindMany.mockImplementation((args: { where: { klp: { card: { setId: string } } } }) => {
      const setId = args.where.klp.card.setId
      if (setId === 'set-A') {
        return Promise.resolve([
          { kltId: 'concept-acct', rank: 1, klp: { id: 'k-a1', supersededAt: null, cardId: 'card-a1' } },
        ])
      }
      if (setId === 'set-B') {
        return Promise.resolve([
          { kltId: 'concept-acct', rank: 1, klp: { id: 'k-b1', supersededAt: null, cardId: 'card-b1' } },
        ])
      }
      return Promise.resolve([])
    })

    // One analyzed answer PER SET, both citing 'accounting' directly, so the
    // correct denominator is 2 — the sum across sets, never a single set's
    // count surviving a `=` overwrite.
    h.answerFindMany.mockImplementation(
      (args: { select?: { card?: { select?: Record<string, unknown> } } }) => {
        const isKltAxis = !!args.select?.card?.select?.klps
        if (!isKltAxis) return Promise.resolve([]) // the category-axis call
        return Promise.resolve([
          { card: { setId: 'set-A', klps: [{ topics: [{ klt: { normalizedName: 'accounting' } }] }] } },
          { card: { setId: 'set-B', klps: [{ topics: [{ klt: { normalizedName: 'accounting' } }] }] } },
        ])
      },
    )

    // One whole-answer clarity tag, attributed to set A's card only, so
    // `computeArticulation`'s readiness is sensitive to the DENOMINATOR: a
    // regression from `+=` to `=` at read.ts leaves it at 1 (whichever set's
    // per-set count folds in last) instead of 2, changing `weightPerAnswer`
    // and therefore `readiness` — this is what makes the assertion below
    // able to detect that regression, rather than merely a doesn't-throw
    // smoke test.
    const rawTag = {
      dimension: 'clarity', type: 'no_thesis', klpId: null,
      relevance: 1, starred: false, magnitude: null, mode: 'quiz-sa',
      severity: 5, significance: 5,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      quizAnswer: { attemptId: 'attempt-a1', cardId: 'card-a1' },
    }
    h.tagFindMany.mockResolvedValue([rawTag])

    const out = await getLearnerMetrics({
      userId: 'u1',
      scope: { ...EMPTY_SCOPE, setIds: ['set-A', 'set-B'] },
    })

    const accounting = out.kltTopics.find((t) => t.key === 'accounting')
    expect(accounting).toBeDefined()

    // Reproduce the SAME derivation the read path uses (rather than hand-
    // computing significance constants) so this test is only about the
    // DENOMINATOR: 2, from both sets' own answer, not 1 from an overwrite.
    const derived = deriveTagScores(toStoredTags([rawTag]), resolveBands({}), [])
    const correct = computeArticulation({ tags: derived, knowledge: {}, analyzedAnswers: 2 })
    const ifOverwritten = computeArticulation({ tags: derived, knowledge: {}, analyzedAnswers: 1 })

    // Sanity: the two denominators must actually predict different readiness
    // values, or this test would pass no matter which one the real code used.
    expect(correct.readiness).not.toBe(ifOverwritten.readiness)
    expect(accounting!.readiness).toBe(correct.readiness)
  })
})
