import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ANSWERED_ATTEMPT_WHERE } from '@/lib/quiz/history'
import { REPEAT_WINDOW_ATTEMPTS } from '@/lib/errors/derive'

// Scoped to getQuizAttemptSummary's include shape only — quiz.ts is large and
// tangled; the other exports are out of scope for this file. Follows the
// vi.hoisted() + vi.mock() pattern in tests/actions/analysis-mc-tf.test.ts.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptFindMany: vi.fn(),
  optionCacheFindMany: vi.fn(),
  tuningFindUnique: vi.fn(),
  errorTagFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findFirst: h.attemptFindFirst, findMany: h.attemptFindMany },
    quizOptionCache: { findMany: h.optionCacheFindMany },
    learnerTuning: { findUnique: h.tuningFindUnique },
    answerErrorTag: { findMany: h.errorTagFindMany },
  },
}))

import { getQuizAttemptSummary } from '@/actions/quiz'

const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.optionCacheFindMany.mockResolvedValue([])
  h.attemptFindMany.mockResolvedValue([])
  h.tuningFindUnique.mockResolvedValue(null)
  h.errorTagFindMany.mockResolvedValue([])
})

describe('getQuizAttemptSummary — analysis include', () => {
  it('fetches klpResults and errorTags with their KLP text joined in', async () => {
    h.attemptFindFirst.mockResolvedValue({
      id: 'a1',
      userId: OWNER,
      session: null,
      answers: [
        {
          id: 'ans1',
          mode: 'multiple-choice',
          cardId: 'c1',
          analysisStatus: 'analyzed',
          klpResults: [
            {
              klpId: 'klp-a',
              status: 'failed',
              credit: 0,
              klp: { text: 'EBITDA excludes interest', kind: 'definition' },
            },
          ],
          errorTags: [
            {
              dimension: 'accuracy',
              type: 'inversion',
              klpId: 'klp-a',
              significance: 7,
              // The columns Spec 3B's read-time derivation reads. A real row
              // always has them; omitting them here modelled a row that cannot
              // exist, which is why adding derivation broke this fixture.
              relevance: 3,
              starred: false,
              magnitude: 10,
              mode: 'quiz-mc',
              severity: 5,
              createdAt: new Date('2026-08-06T00:00:00Z'),
              klp: { text: 'EBITDA excludes interest', kind: 'definition' },
              secondaryKlp: null,
            },
          ],
          card: { contentBlocks: [] },
        },
      ],
    })

    const result = await getQuizAttemptSummary('a1')

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.attempt.answers[0].klpResults[0].klp.text).toBe('EBITDA excludes interest')
    expect(result.data.attempt.answers[0].errorTags[0].dimension).toBe('accuracy')

    // Regression guard on the actual query shape, not just the mocked return.
    const includeArg = h.attemptFindFirst.mock.calls[0][0].include.answers.include
    expect(includeArg).toHaveProperty('klpResults')
    expect(includeArg).toHaveProperty('errorTags')
  })

  it('does not throw when an error tag has a null klp (deleted card, or a whole-answer tag)', async () => {
    h.attemptFindFirst.mockResolvedValue({
      id: 'a1',
      userId: OWNER,
      session: null,
      answers: [
        {
          id: 'ans1',
          mode: 'short-answer',
          cardId: 'c1',
          analysisStatus: 'analyzed',
          klpResults: [],
          errorTags: [
            {
              dimension: 'conciseness',
              type: 'rambling',
              klpId: null,
              significance: 3,
              relevance: 3,
              starred: false,
              magnitude: 4,
              mode: 'quiz-sa',
              severity: 2,
              createdAt: new Date('2026-08-06T00:00:00Z'),
              klp: null,
              secondaryKlp: null,
            },
          ],
          card: { contentBlocks: [] },
        },
      ],
    })

    const result = await getQuizAttemptSummary('a1')
    expect(result.success).toBe(true)
  })
})

describe('read-time derivation on the attempt summary (Spec 3B §3.4)', () => {
  const answerWith = (tag: Record<string, unknown>) => ({
    id: 'ans1', mode: 'short-answer', cardId: 'c1', analysisStatus: 'analyzed',
    card: { contentBlocks: [] }, klpResults: [],
    errorTags: [{
      dimension: 'accuracy', type: 'inversion', klpId: 'klp1', secondaryKlpId: null,
      relevance: 3, starred: false, magnitude: 10, mode: 'quiz-sa',
      severity: 5, significance: 9, quote: null,
      createdAt: new Date('2026-08-06T00:00:00Z'),
      klp: { text: 'a point', kind: 'fact' }, secondaryKlp: null,
      ...tag,
    }],
  })

  it("reports a severity derived from the user's bands, not the value stored at grading time", async () => {
    // Stored severity 5 under the default inversion band [2,5]. The user has
    // retuned inversion to [1,2], so the same answer must now read 2.
    h.tuningFindUnique.mockResolvedValue({
      strategy: 'balanced', bands: { inversion: [1, 2] }, thresholds: null,
    })
    h.attemptFindFirst.mockResolvedValue({
      id: 'a1', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue([{ id: 'a1' }])

    const res = await getQuizAttemptSummary('a1')
    expect(res.success).toBe(true)
    if (!res.success) throw new Error(res.error)
    const [derivedTag] = res.data.attempt.answers[0].errorTags
    expect(derivedTag.severity).toBe(2)
    expect(derivedTag.significance).toBeLessThan(9)
  })

  it('still falls back to the stored severity for a legacy row with no magnitude', async () => {
    h.tuningFindUnique.mockResolvedValue({
      strategy: 'balanced', bands: { inversion: [1, 2] }, thresholds: null,
    })
    h.attemptFindFirst.mockResolvedValue({
      id: 'a1', userId: OWNER, session: null,
      answers: [answerWith({ magnitude: null, mode: null, severity: 4 })],
    })
    h.attemptFindMany.mockResolvedValue([{ id: 'a1' }])

    const res = await getQuizAttemptSummary('a1')
    if (!res.success) throw new Error(res.error)
    expect(res.data.attempt.answers[0].errorTags[0].severity).toBe(4)
  })

  it('preserves the joined klp text the badge renderer reads', async () => {
    // The merge must add fields, never replace the tag object wholesale —
    // `klp.text` comes from the include and is not on the derived shape.
    h.tuningFindUnique.mockResolvedValue(null)
    h.attemptFindFirst.mockResolvedValue({
      id: 'a1', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue([{ id: 'a1' }])

    const res = await getQuizAttemptSummary('a1')
    if (!res.success) throw new Error(res.error)
    const [derivedTag] = res.data.attempt.answers[0].errorTags
    expect(derivedTag.klp.text).toBe('a point')
    expect(derivedTag.dimension).toBe('accuracy')
  })

  it("draws the repeat window from the user's REAL ANSWERED attempt sequence", async () => {
    // Two requirements in one assertion, spec §3.4.1(a):
    //  - unscoped and chronological: deriving the order from the tags makes
    //    CLEAN attempts invisible, so an error repeated after ten flawless
    //    sittings still scores "+1, they keep doing this";
    //  - ANSWERED_ATTEMPT_WHERE: src/lib/metrics/read.ts filters zero-answer
    //    attempts out of this exact window, and abandoned attempts still
    //    accumulate (item 2b filters rather than deletes). An unfiltered query
    //    here gives the SAME attempt a different index, and therefore a
    //    different repeatBonus, than the dashboard computes.
    h.tuningFindUnique.mockResolvedValue(null)
    h.attemptFindFirst.mockResolvedValue({
      id: 'a9', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue([])

    await getQuizAttemptSummary('a9')
    expect(h.attemptFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: OWNER, ...ANSWERED_ATTEMPT_WHERE },
        orderBy: { createdAt: 'asc' },
      }),
    )
  })

  it('awards a repeat bonus for an error the learner made in a PRIOR attempt', async () => {
    // Spec §3.4.1(b). deriveTagScores builds `seen` only from the tags it is
    // given and looks STRICTLY backward, so deriving over one attempt's tags
    // makes repeatBonus structurally always 0 — the code runs, every
    // single-attempt fixture passes, and the number is wrong for exactly the
    // learner the bonus describes. This fixture is the only kind that can fail.
    h.tuningFindUnique.mockResolvedValue(null)
    h.attemptFindFirst.mockResolvedValue({
      id: 'a2', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
    // The same (type, klpId) in the immediately preceding attempt.
    h.errorTagFindMany.mockResolvedValue([{
      dimension: 'accuracy', type: 'inversion', klpId: 'klp1', secondaryKlpId: null,
      relevance: 3, starred: false, magnitude: 10, mode: 'quiz-sa',
      severity: 5, significance: 9, quote: null,
      createdAt: new Date('2026-08-05T00:00:00Z'),
      quizAnswer: { attemptId: 'a1', cardId: 'c1' },
    }])

    const res = await getQuizAttemptSummary('a2')
    if (!res.success) throw new Error(res.error)
    expect(res.data.attempt.answers[0].errorTags[0].repeatBonus).toBe(1)
  })

  it('reports NO repeat bonus when the prior window is clean', async () => {
    // The other half: without this the assertion above could pass by awarding
    // a bonus unconditionally.
    h.tuningFindUnique.mockResolvedValue(null)
    h.attemptFindFirst.mockResolvedValue({
      id: 'a2', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
    h.errorTagFindMany.mockResolvedValue([])

    const res = await getQuizAttemptSummary('a2')
    if (!res.success) throw new Error(res.error)
    expect(res.data.attempt.answers[0].errorTags[0].repeatBonus).toBe(0)
  })

  it('scopes the repeat context to the window, the user, and analyzed answers', async () => {
    // Bounded by REPEAT_WINDOW_ATTEMPTS because that is exactly how far back
    // the bonus looks; `analysisStatus: 'analyzed'` because that is the
    // population read.ts's tag query uses, and a context drawn from a wider
    // one reintroduces the divergence from the other side.
    h.tuningFindUnique.mockResolvedValue(null)
    h.attemptFindFirst.mockResolvedValue({
      id: 'a5', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue(
      ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ id })),
    )

    await getQuizAttemptSummary('a5')
    const where = h.errorTagFindMany.mock.calls[0][0].where
    expect(where.quizAnswer.analysisStatus).toBe('analyzed')
    expect(where.quizAnswer.userId).toBe(OWNER)
    // a2, a3, a4 — the REPEAT_WINDOW_ATTEMPTS answered attempts before a5.
    // Not a1, and not a5 itself (its tags are already in hand).
    expect(REPEAT_WINDOW_ATTEMPTS).toBe(3)
    expect(where.quizAnswer.attemptId.in).toEqual(['a2', 'a3', 'a4'])
  })

  it('skips the context query entirely on a first attempt', async () => {
    h.tuningFindUnique.mockResolvedValue(null)
    h.attemptFindFirst.mockResolvedValue({
      id: 'a1', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue([{ id: 'a1' }])

    await getQuizAttemptSummary('a1')
    expect(h.errorTagFindMany).not.toHaveBeenCalled()
  })
})
