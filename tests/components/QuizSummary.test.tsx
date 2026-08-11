// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { QuizSummary } from '@/components/quiz/QuizSummary'

const h = vi.hoisted(() => ({ resetQuizAnswer: vi.fn() }))

// RTL's auto-cleanup between tests relies on a global `afterEach`, which
// this repo doesn't register (vitest.config.ts has no `globals: true`) —
// without this, one test's rendered DOM bleeds into the next test's queries.
afterEach(cleanup)

vi.mock('@/actions/quiz', () => ({
  getQuizAttemptSummary: vi.fn(),
}))
import { getQuizAttemptSummary } from '@/actions/quiz'

// SessionInsightView (rendered inside QuizSummary for short-answer attempts)
// pulls in a server action and a toast library; neither is exercised by
// these tests, which only cover the analysis-display additions.
vi.mock('@/actions/study-session', () => ({
  generateSessionInsight: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// QuizSummary imports resetQuizAnswer for the permalink's per-question erase
// control. It's a 'use server' module, so importing it for real drags
// next-auth into jsdom and the whole suite fails to load with
// "Cannot find module next/server".
vi.mock('@/actions/memory', () => ({ resetQuizAnswer: h.resetQuizAnswer }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

function baseAnswer(overrides: Record<string, unknown>) {
  return {
    id: 'ans1',
    mode: 'multiple-choice',
    isCorrect: false,
    correctAnswer: 'B',
    selectedOption: 'A',
    options: ['A', 'B'],
    card: { term: 'Q', contentBlocks: [] },
    klpResults: [],
    errorTags: [],
    analysisStatus: 'analyzed',
    ...overrides,
  }
}

describe('QuizSummary — analysis display', () => {
  it('renders a KLP checklist entry using the KLP text, not an id', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [
            baseAnswer({
              klpResults: [
                { klpId: 'klp-a', status: 'failed', klp: { text: 'EBITDA excludes interest expense' } },
              ],
            }),
          ],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await waitFor(() => screen.getByText(/EBITDA excludes interest expense/))
    expect(screen.queryByText('klp-a')).not.toBeInTheDocument()
  })

  it('renders an error tag with a humanized label, not the raw type string', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [
            baseAnswer({
              errorTags: [
                { dimension: 'accuracy', type: 'factual_error', klpId: 'klp-a', significance: 5, klp: { text: 'x' } },
              ],
            }),
          ],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await waitFor(() => screen.getByText(/Factual error/))
    expect(screen.queryByText('factual_error')).not.toBeInTheDocument()
  })

  it('shows a degraded note for no_provenance, not silence', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [baseAnswer({ analysisStatus: 'no_provenance' })],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await waitFor(() => screen.getByText(/wasn't available/i))
  })

  it('renders nothing extra for a legacy answer with analysisStatus null', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [baseAnswer({ analysisStatus: null })],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await waitFor(() => screen.getAllByText('Q').length > 0) // the card renders
    expect(screen.queryByText(/wasn't available/i)).not.toBeInTheDocument()
  })
})

describe('QuizSummary — session rollup', () => {
  // TabsContent in this repo's ui/tabs.tsx renders null while inactive (not
  // just CSS-hidden), and the default tab is "review" — the rollup card
  // lives under "summary", so every test here must switch tabs first.
  async function switchToOverallAnalysis() {
    await waitFor(() => screen.getByText('Overall Analysis'))
    fireEvent.click(screen.getByText('Overall Analysis'))
  }

  it('shows the rollup for a NON-short-answer attempt (unlike SessionInsightView, not gated to short-answer)', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [
            baseAnswer({
              errorTags: [
                { dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 5, klp: { text: 'X' } },
              ],
            }),
            baseAnswer({ id: 'ans2', analysisStatus: 'no_provenance' }),
          ],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await switchToOverallAnalysis()
    await waitFor(() => screen.getByText(/1 of 2 questions analyzed/i))
  })

  it('does not render an empty breakdown when analyzedCount is 0', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [baseAnswer({ analysisStatus: 'no_klps' })],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await switchToOverallAnalysis()
    await waitFor(() => screen.getByText(/0 of 1 questions analyzed/i))
    expect(screen.queryByText(/Accuracy/)).not.toBeInTheDocument()
  })

  it('shows the top struggled KLP by its text, not its id', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [
            baseAnswer({
              klpResults: [{ klpId: 'klp-a', status: 'failed', klp: { text: 'D&A is added back' } }],
              errorTags: [
                { dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 5, klp: { text: 'D&A is added back' } },
              ],
            }),
          ],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await switchToOverallAnalysis()
    await waitFor(() => screen.getByText(/D&A is added back/))
  })
})

describe('QuizSummary — the canReset opt-in', () => {
  // The `as any` the older tests above use is a no-explicit-any lint error
  // apiece; go through a typed handle instead so these additions don't raise
  // the repo's lint baseline.
  const summaryMock = getQuizAttemptSummary as unknown as ReturnType<typeof vi.fn>

  function oneAnswerAttempt() {
    summaryMock.mockResolvedValue({
      success: true,
      data: {
        attempt: { mode: 'multiple-choice', answers: [baseAnswer({})] },
        insight: null,
      },
    })
  }

  it('renders no erase control by default, so the live end-of-quiz screen is untouched', async () => {
    // QuizContainer renders this same component the moment a learner finishes.
    // An erase control there is one mis-tap away from destroying the work they
    // just did — the permalink is the only surface that opts in.
    oneAnswerAttempt()
    render(<QuizSummary setId="s1" attemptId="a1" />)
    await waitFor(() => screen.getByText(/Question 1/))
    expect(screen.queryByRole('button', { name: /erase question/i })).not.toBeInTheDocument()
  })

  it('renders one erase control per question when opted in', async () => {
    oneAnswerAttempt()
    render(<QuizSummary setId="s1" attemptId="a1" canReset />)
    await waitFor(() => screen.getByRole('button', { name: /erase question 1/i }))
  })

  it('reloads the attempt from the server after erasing a question', async () => {
    // Not a local filter: erasing the last answer deletes the whole attempt,
    // and the attempt's stored score is recomputed server-side.
    oneAnswerAttempt()
    h.resetQuizAnswer.mockResolvedValue({ success: true })

    render(<QuizSummary setId="s1" attemptId="a1" canReset />)
    const eraseButton = await waitFor(() =>
      screen.getByRole('button', { name: /erase question 1/i }),
    )
    summaryMock.mockClear()
    fireEvent.click(eraseButton)

    await waitFor(() => expect(h.resetQuizAnswer).toHaveBeenCalledWith('ans1'))
    await waitFor(() => expect(getQuizAttemptSummary).toHaveBeenCalledWith('a1'))
  })

  it('does not reload when the erase fails', async () => {
    // A refetch after a failed erase would redraw the identical page and read
    // as though something happened.
    oneAnswerAttempt()
    h.resetQuizAnswer.mockResolvedValue({ success: false, error: 'Failed to reset this question' })

    render(<QuizSummary setId="s1" attemptId="a1" canReset />)
    const eraseButton = await waitFor(() =>
      screen.getByRole('button', { name: /erase question 1/i }),
    )
    summaryMock.mockClear()
    fireEvent.click(eraseButton)

    await waitFor(() => expect(h.resetQuizAnswer).toHaveBeenCalled())
    expect(getQuizAttemptSummary).not.toHaveBeenCalled()
  })
})
