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
  progressFindMany: vi.fn(),
  setFindUnique: vi.fn(),
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
    cardProgress: { findMany: h.progressFindMany },
    set: { findUnique: h.setFindUnique },
  },
}))

import { getLearnerMetrics } from '@/lib/metrics/read'
import { EMPTY_SCOPE } from '@/lib/memory/scope'

beforeEach(() => {
  vi.clearAllMocks()
  for (const fn of [
    h.tagFindMany, h.answerFindMany, h.klpStateFindMany, h.klpResultFindMany,
    h.eventFindMany, h.attemptFindMany, h.categoryFindMany, h.progressFindMany,
  ]) {
    fn.mockResolvedValue([])
  }
  h.setFindUnique.mockResolvedValue(null)
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
