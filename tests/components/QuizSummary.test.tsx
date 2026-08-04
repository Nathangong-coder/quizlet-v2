// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QuizSummary } from '@/components/quiz/QuizSummary'

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
