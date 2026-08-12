import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `discardSkippedQuizAttempt` deletes a real row, so every one of its four
 * guards gets its OWN test. A single happy-path test passes with any one guard
 * missing — which is the entire reason the plan enumerates them
 * (docs/superpowers/plans/2026-08-12-empty-quiz-attempts.md, Task 5 Step 1).
 *
 * Mocking follows tests/actions/quiz-submit-ownership.test.ts: `vi.mock` on
 * `@/lib/db` and `@/auth`, plus the modules `@/actions/quiz` pulls in at import
 * time that would otherwise reach the network or a real client. There is no
 * live-DB harness in this repo.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  attemptFindFirst: vi.fn(),
  executeErasure: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findFirst: h.attemptFindFirst },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/memory/erase-execute', () => ({ executeErasure: h.executeErasure }))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: vi.fn(),
  resolveTaskModel: vi.fn(),
  AiGenerationError: class extends Error {},
}))
vi.mock('@/actions/klp', () => ({ ensureKlpsReady: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ safeProfileBlock: vi.fn() }))
vi.mock('@/lib/quiz/coin-flip', () => ({ pickTfVariant: vi.fn() }))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: vi.fn() }))

import { discardSkippedQuizAttempt } from '@/actions/quiz'

const OWNER = 'user-owner'
const ATTEMPT = 'attempt-1'

/** The shape the action's own `select` asks for. */
function attemptRow(over: Partial<{ printable: boolean; answers: number }> = {}) {
  return {
    id: ATTEMPT,
    printable: over.printable ?? false,
    _count: { answers: over.answers ?? 0 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.attemptFindFirst.mockResolvedValue(attemptRow())
  h.executeErasure.mockResolvedValue(undefined)
})

function expectRefused(result: Awaited<ReturnType<typeof discardSkippedQuizAttempt>>) {
  expect(result.success).toBe(true)
  if (!result.success) throw new Error('expected a successful refusal, not an error')
  expect(result.data.discarded).toBe(false)
  expect(h.executeErasure).not.toHaveBeenCalled()
}

describe('discardSkippedQuizAttempt refuses unless all four conditions hold', () => {
  it('1. refuses when the client reports answers, WITHOUT querying at all', async () => {
    // The learner's intent signal. Not redundant with the server-side check
    // below: an answer that fails to grade does not throw — `commitAll` calls
    // `showError` and continues — so a learner who answered three questions and
    // lost all three to an AI failure ALSO arrives here with zero stored
    // answers. Only the client's count separates them.
    const result = await discardSkippedQuizAttempt({ attemptId: ATTEMPT, clientAnsweredCount: 3 })

    expectRefused(result)
    // Cheapest guard first: it must short-circuit before any database round
    // trip, which also makes the ordering assertable.
    expect(h.attemptFindFirst).not.toHaveBeenCalled()
  })

  it('2. refuses when the server still sees answers on the attempt', async () => {
    // The authority. The client may never order a deletion on its own, so a
    // client claiming zero while rows exist is refused.
    h.attemptFindFirst.mockResolvedValue(attemptRow({ answers: 2 }))

    expectRefused(await discardSkippedQuizAttempt({ attemptId: ATTEMPT, clientAnsweredCount: 0 }))
  })

  it('3. refuses a printable attempt', async () => {
    // A printable attempt is created to be printed and never submitted, so a
    // discard here would be reaching outside this flow.
    h.attemptFindFirst.mockResolvedValue(attemptRow({ printable: true }))

    expectRefused(await discardSkippedQuizAttempt({ attemptId: ATTEMPT, clientAnsweredCount: 0 }))
  })

  it("4. refuses another user's attempt (indistinguishable from not-found)", async () => {
    // Owner-scoped `findFirst`, per the erasure module's convention: absent and
    // not-yours return the same thing, so a probe learns nothing.
    h.attemptFindFirst.mockResolvedValue(null)

    const result = await discardSkippedQuizAttempt({
      attemptId: 'attempt-belonging-to-someone-else',
      clientAnsweredCount: 0,
    })

    expectRefused(result)
    expect(h.attemptFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt-belonging-to-someone-else', userId: OWNER },
      }),
    )
  })

  it('refuses an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)

    const result = await discardSkippedQuizAttempt({ attemptId: ATTEMPT, clientAnsweredCount: 0 })

    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    expect(result.error).toBe('Unauthorized')
    expect(h.executeErasure).not.toHaveBeenCalled()
  })
})

describe('discardSkippedQuizAttempt discards when all four hold', () => {
  it('routes through executeErasure with the attempt scope', async () => {
    const result = await discardSkippedQuizAttempt({ attemptId: ATTEMPT, clientAnsweredCount: 0 })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected success')
    expect(result.data.discarded).toBe(true)
    // No second copy of the deletion logic: `planErasure`'s existing
    // zero-answer branch (src/lib/memory/erase.ts:371-378) removes the attempt,
    // its StudySession and its cascading QuizQuestion rows.
    expect(h.executeErasure).toHaveBeenCalledTimes(1)
    expect(h.executeErasure).toHaveBeenCalledWith(OWNER, {
      kind: 'attempt',
      attemptId: ATTEMPT,
    })
  })

  it('reports a failed erasure as an error, not as a silent discard', async () => {
    // The caller degrades to the normal results screen on an error; reporting
    // `discarded: true` here would show "Quiz Skipped" over a surviving row.
    h.executeErasure.mockRejectedValue(new Error('tx timeout'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await discardSkippedQuizAttempt({ attemptId: ATTEMPT, clientAnsweredCount: 0 })

    expect(result.success).toBe(false)
    consoleError.mockRestore()
  })
})
