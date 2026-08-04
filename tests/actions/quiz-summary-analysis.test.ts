import { describe, it, expect, vi, beforeEach } from 'vitest'

// Scoped to getQuizAttemptSummary's include shape only — quiz.ts is large and
// tangled; the other exports are out of scope for this file. Follows the
// vi.hoisted() + vi.mock() pattern in tests/actions/analysis-mc-tf.test.ts.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  attemptFindUnique: vi.fn(),
  optionCacheFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findUnique: h.attemptFindUnique },
    quizOptionCache: { findMany: h.optionCacheFindMany },
  },
}))

import { getQuizAttemptSummary } from '@/actions/quiz'

const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.optionCacheFindMany.mockResolvedValue([])
})

describe('getQuizAttemptSummary — analysis include', () => {
  it('fetches klpResults and errorTags with their KLP text joined in', async () => {
    h.attemptFindUnique.mockResolvedValue({
      id: 'a1',
      userId: OWNER,
      session: null,
      answers: [
        {
          id: 'ans1',
          mode: 'multiple-choice',
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
    const includeArg = h.attemptFindUnique.mock.calls[0][0].include.answers.include
    expect(includeArg).toHaveProperty('klpResults')
    expect(includeArg).toHaveProperty('errorTags')
  })

  it('does not throw when an error tag has a null klp (deleted card, or a whole-answer tag)', async () => {
    h.attemptFindUnique.mockResolvedValue({
      id: 'a1',
      userId: OWNER,
      session: null,
      answers: [
        {
          id: 'ans1',
          mode: 'short-answer',
          analysisStatus: 'analyzed',
          klpResults: [],
          errorTags: [
            {
              dimension: 'conciseness',
              type: 'rambling',
              klpId: null,
              significance: 3,
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
