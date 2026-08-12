// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { Card } from '@prisma/client'
import type { QuizSectionHandle } from '@/components/quiz/section'

// RTL's auto-cleanup between tests relies on a global `afterEach`, which this
// repo doesn't register (vitest.config.ts has no `globals: true`) — without
// this, one test's rendered DOM bleeds into the next and a second render makes
// getByRole throw on multiple matches.
afterEach(cleanup)

const h = vi.hoisted(() => ({
  startQuizAttempt: vi.fn(),
  getQuizAttemptCards: vi.fn(),
  discardSkippedQuizAttempt: vi.fn(),
  finishStudySession: vi.fn(),
  generateSessionInsight: vi.fn(),
  commitAll: vi.fn(),
  answeredCount: vi.fn(),
  toastError: vi.fn(),
}))

// QuizContainer imports 'use server' modules. Importing one for real drags
// next-auth into jsdom and the file dies at load with "Cannot find module
// next/server", before any test runs.
vi.mock('@/actions/quiz', () => ({
  startQuizAttempt: h.startQuizAttempt,
  getQuizAttemptCards: h.getQuizAttemptCards,
  discardSkippedQuizAttempt: h.discardSkippedQuizAttempt,
}))
// QuizContainer statically imports all four sections, so MatchingQuiz's own
// server-action module is pulled in even when only the MC section renders.
vi.mock('@/actions/quiz-matching', () => ({
  submitMatchingAnswers: vi.fn(),
}))
vi.mock('@/actions/study-session', () => ({
  finishStudySession: h.finishStudySession,
  generateSessionInsight: h.generateSessionInsight,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: h.toastError } }))

// The section is stubbed rather than driven through its real UI: the whole
// subject here is the ORDER of calls in handleSubmitQuiz keyed on what the
// handle reports and whether commitAll threw. Driving a real section makes
// "commitAll threw" nearly unreachable, since the real ones catch individual
// answer failures and continue.
vi.mock('@/components/quiz/MultipleChoiceQuiz', async () => {
  const React = await import('react')
  return {
    MultipleChoiceQuiz: React.forwardRef<QuizSectionHandle, { cards: Card[]; attemptId: string }>(
      function MultipleChoiceQuizStub(_props, ref) {
        React.useImperativeHandle(ref, () => ({
          commitAll: h.commitAll,
          answeredCount: h.answeredCount,
        }))
        return React.createElement('div', { 'data-testid': 'mc-section' })
      },
    ),
  }
})

// QuizSummary fetches its own attempt summary and renders tabs; none of that
// is under test. A stub makes "which screen rendered" unambiguous.
vi.mock('@/components/quiz/QuizSummary', async () => {
  const React = await import('react')
  return {
    QuizSummary: () => React.createElement('div', null, 'Quiz Summary Stub'),
  }
})

import { QuizContainer } from '@/components/quiz/QuizContainer'

function card(id: string): Card {
  return {
    id,
    term: `Term ${id}`,
    definition: `Definition ${id}`,
    setId: 's1',
  } as unknown as Card
}

beforeEach(() => {
  vi.clearAllMocks()
  h.startQuizAttempt.mockResolvedValue({
    success: true,
    data: { attemptId: 'a1', sessionId: 'sess1' },
  })
  h.getQuizAttemptCards.mockResolvedValue({ success: true, data: { cards: [card('c1')] } })
  h.finishStudySession.mockResolvedValue({ success: true })
  h.generateSessionInsight.mockResolvedValue({ success: true })
  h.commitAll.mockResolvedValue(undefined)
  h.answeredCount.mockReturnValue(0)
  h.discardSkippedQuizAttempt.mockResolvedValue({ success: true, data: { discarded: false } })
})

async function renderAndSubmit() {
  render(
    <QuizContainer
      setId="s1"
      cards={[]}
      setup={{ questionMode: ['multiple-choice'], questionCount: 1 }}
    />,
  )
  const submit = await waitFor(() => screen.getByRole('button', { name: /submit overall quiz/i }))
  fireEvent.click(submit)
  return submit
}

describe('QuizContainer — the skipped-quiz path', () => {
  it('renders the Skipped notice when the server discarded the attempt', async () => {
    h.discardSkippedQuizAttempt.mockResolvedValue({ success: true, data: { discarded: true } })

    await renderAndSubmit()

    await waitFor(() => screen.getByText(/quiz skipped/i))
    expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument()
    expect(screen.queryByText('Quiz Summary Stub')).not.toBeInTheDocument()
  })

  it('passes the summed answeredCount as the client intent signal', async () => {
    h.discardSkippedQuizAttempt.mockResolvedValue({ success: true, data: { discarded: true } })

    await renderAndSubmit()

    await waitFor(() =>
      expect(h.discardSkippedQuizAttempt).toHaveBeenCalledWith({
        attemptId: 'a1',
        clientAnsweredCount: 0,
      }),
    )
  })

  it('does NOT close the study session or generate an insight on the discard path', async () => {
    // The session is being deleted with the attempt. Closing it first is wasted
    // work, and an AI narrative about a quiz that no longer exists is worse.
    h.discardSkippedQuizAttempt.mockResolvedValue({ success: true, data: { discarded: true } })

    await renderAndSubmit()

    await waitFor(() => screen.getByText(/quiz skipped/i))
    expect(h.finishStudySession).not.toHaveBeenCalled()
    expect(h.generateSessionInsight).not.toHaveBeenCalled()
  })

  it('renders QuizSummary when the server refuses the discard', async () => {
    // A refusal is `success: true, discarded: false` — a normal outcome, not an
    // error. Today's results screen is exactly right for it.
    h.discardSkippedQuizAttempt.mockResolvedValue({ success: true, data: { discarded: false } })

    await renderAndSubmit()

    await waitFor(() => screen.getByText('Quiz Summary Stub'))
    expect(screen.queryByText(/quiz skipped/i)).not.toBeInTheDocument()
    await waitFor(() => expect(h.finishStudySession).toHaveBeenCalledWith({ sessionId: 'sess1' }))
  })

  it('degrades to QuizSummary — not a grading error — when the discard itself fails', async () => {
    h.discardSkippedQuizAttempt.mockRejectedValue(new Error('network'))

    await renderAndSubmit()

    await waitFor(() => screen.getByText('Quiz Summary Stub'))
    expect(h.toastError).not.toHaveBeenCalledWith('Something went wrong grading your answers')
  })

  it('degrades to QuizSummary when the discard returns success: false', async () => {
    h.discardSkippedQuizAttempt.mockResolvedValue({ success: false, error: 'boom' })

    await renderAndSubmit()

    await waitFor(() => screen.getByText('Quiz Summary Stub'))
    expect(screen.queryByText(/quiz skipped/i)).not.toBeInTheDocument()
  })

  it('never attempts a discard when commitAll threw, and shows the results screen', async () => {
    // A grading crash is not a skipped quiz. Labelling it "Skipped" would hide
    // the defect behind a message saying the learner did nothing.
    h.commitAll.mockRejectedValue(new Error('grading exploded'))

    await renderAndSubmit()

    await waitFor(() => screen.getByText('Quiz Summary Stub'))
    expect(h.discardSkippedQuizAttempt).not.toHaveBeenCalled()
    expect(h.toastError).toHaveBeenCalledWith('Something went wrong grading your answers')
    expect(screen.queryByText(/quiz skipped/i)).not.toBeInTheDocument()
  })
})

describe('QuizContainer — submit footer copy', () => {
  it('no longer claims an unanswered quiz scores zero', async () => {
    render(
      <QuizContainer
        setId="s1"
        cards={[]}
        setup={{ questionMode: ['multiple-choice'], questionCount: 1 }}
      />,
    )
    await waitFor(() => screen.getByRole('button', { name: /submit overall quiz/i }))

    expect(screen.getByText(/you can submit at any time/i)).toBeInTheDocument()
    expect(screen.queryByText(/simply score zero/i)).not.toBeInTheDocument()
    expect(screen.getByText(/isn't saved/i)).toBeInTheDocument()
  })
})
