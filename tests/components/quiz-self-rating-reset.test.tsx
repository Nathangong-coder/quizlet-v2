// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { createRef } from 'react'
import type { Card } from '@prisma/client'

// Whole-branch review, Important 2: a rating is a judgment about ONE answer.
// Changing the answer must drop it — otherwise "Certain" about option A is
// submitted as "Certain" about option B and the calibration counts lie.

afterEach(cleanup)

const h = vi.hoisted(() => ({
  getOrGenerateMultipleChoiceOptions: vi.fn(),
  submitMultipleChoiceAnswer: vi.fn(),
  submitShortAnswer: vi.fn(),
  submitTrueFalseAnswer: vi.fn(),
  getTrueFalseQuestion: vi.fn(),
  startDiagnosticTest: vi.fn(),
  submitDiagnosticTest: vi.fn(),
}))

vi.mock('@/actions/quiz', () => ({
  getOrGenerateMultipleChoiceOptions: h.getOrGenerateMultipleChoiceOptions,
  submitMultipleChoiceAnswer: h.submitMultipleChoiceAnswer,
  submitShortAnswer: h.submitShortAnswer,
  submitTrueFalseAnswer: h.submitTrueFalseAnswer,
  getTrueFalseQuestion: h.getTrueFalseQuestion,
}))
vi.mock('@/actions/diagnostic', () => ({
  startDiagnosticTest: h.startDiagnosticTest,
  submitDiagnosticTest: h.submitDiagnosticTest,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import type { QuizSectionHandle } from '@/components/quiz/section'
import { MultipleChoiceQuiz } from '@/components/quiz/MultipleChoiceQuiz'
import { ShortAnswerQuiz } from '@/components/quiz/ShortAnswerQuiz'
import { TrueFalseQuiz } from '@/components/quiz/TrueFalseQuiz'
import { DiagnosticClient } from '@/components/diagnostic/DiagnosticClient'

function card(id: string): Card {
  return { id, term: `Term ${id}`, definition: `Definition ${id}`, setId: 's1' } as unknown as Card
}
const cards = [card('c1')]

const picker = (name: string) => screen.getByRole('radio', { name })
const checked = (name: string) => picker(name).getAttribute('aria-checked')

beforeEach(() => {
  vi.clearAllMocks()
  h.submitMultipleChoiceAnswer.mockResolvedValue({ success: true, data: { isCorrect: true, score: 100 } })
  h.submitShortAnswer.mockResolvedValue({ success: true, data: { grade: {}, score: 80 } })
  h.submitTrueFalseAnswer.mockResolvedValue({ success: true, data: { isCorrect: true, score: 100 } })
  h.submitDiagnosticTest.mockResolvedValue({
    success: true,
    data: {
      attemptId: 'att1',
      setTitle: 'Set',
      score: 8,
      engineVersion: 1,
      report: { overview: 'Solid.', strengths: [], gaps: [], recommendations: [], learningPoints: [] },
      questions: [],
    },
  })
})

describe('a rating made before an answer change is not submitted with the new answer', () => {
  it('multiple choice: picking another option clears the rating', async () => {
    h.getOrGenerateMultipleChoiceOptions.mockResolvedValue({
      success: true,
      data: { options: ['Alpha', 'Beta'], correctAnswer: 'Alpha' },
    })
    const ref = createRef<QuizSectionHandle>()
    render(<MultipleChoiceQuiz ref={ref} cards={cards} attemptId="a1" />)
    // The option is a radio-group item (Base UI) — click the item by its
    // accessible name, not the label, which matches the hidden input too.
    const alpha = await screen.findByRole('radio', { name: 'Alpha' })
    fireEvent.click(alpha)
    fireEvent.click(picker('Certain'))
    expect(checked('Certain')).toBe('true')

    fireEvent.click(screen.getByRole('radio', { name: 'Beta' }))
    // Picker still shown (an answer exists) but nothing selected.
    expect(checked('Certain')).toBe('false')
    for (const n of ['No idea', 'Unsure', 'Fairly sure', 'Certain']) expect(checked(n)).toBe('false')

    await act(async () => { await ref.current!.commitAll() })
    expect(h.submitMultipleChoiceAnswer).toHaveBeenCalledTimes(1)
    const sent = h.submitMultipleChoiceAnswer.mock.calls[0][0]
    expect(sent.selectedOption).toBe('Beta')
    expect(sent.selfRating).toBeUndefined()
  })

  it('true/false: switching true -> false clears the rating', async () => {
    h.getTrueFalseQuestion.mockResolvedValue({ success: true, data: { statement: 'Sky is blue.' } })
    const ref = createRef<QuizSectionHandle>()
    render(<TrueFalseQuiz ref={ref} cards={cards} attemptId="a1" />)
    const trueBtn = await waitFor(() => {
      const b = screen.getByRole('button', { name: 'true' }) as HTMLButtonElement
      expect(b.disabled).toBe(false)
      return b
    })
    fireEvent.click(trueBtn)
    fireEvent.click(picker('Unsure'))
    expect(checked('Unsure')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'false' }))
    expect(checked('Unsure')).toBe('false')

    await act(async () => { await ref.current!.commitAll() })
    const sent = h.submitTrueFalseAnswer.mock.calls[0][0]
    expect(sent.selectedOption).toBe('false')
    expect(sent.selfRating).toBeUndefined()
  })

  it('short answer: clearing the text hides the picker and drops the rating; a retyped answer is unrated', async () => {
    const ref = createRef<QuizSectionHandle>()
    render(<ShortAnswerQuiz ref={ref} cards={cards} attemptId="a1" />)
    const box = screen.getByPlaceholderText(/type your answer/i)
    fireEvent.change(box, { target: { value: 'first answer' } })
    fireEvent.click(picker('Fairly sure'))
    expect(checked('Fairly sure')).toBe('true')

    fireEvent.change(box, { target: { value: '   ' } })
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.change(box, { target: { value: 'second answer' } })
    expect(checked('Fairly sure')).toBe('false')

    await act(async () => { await ref.current!.commitAll() })
    const sent = h.submitShortAnswer.mock.calls[0][0]
    expect(sent.answer).toBe('second answer')
    expect(sent.selfRating).toBeUndefined()
  })

  it('short answer: editing without blanking keeps the rating (the answer is still the same attempt)', async () => {
    const ref = createRef<QuizSectionHandle>()
    render(<ShortAnswerQuiz ref={ref} cards={cards} attemptId="a1" />)
    const box = screen.getByPlaceholderText(/type your answer/i)
    fireEvent.change(box, { target: { value: 'first' } })
    fireEvent.click(picker('Certain'))
    fireEvent.change(box, { target: { value: 'first, expanded' } })
    expect(checked('Certain')).toBe('true')
  })

  it('diagnostic: clearing the text drops the rating; a retyped answer submits unrated', async () => {
    h.startDiagnosticTest.mockResolvedValue({
      success: true,
      data: {
        attemptId: 'att1',
        setTitle: 'Set',
        questions: [{ id: 'q1', position: 0, kind: 'core', prompt: 'Why?', learningPoint: 'x' }],
      },
    })
    render(
      <DiagnosticClient
        sets={[{ id: 's1', title: 'Set', cardCount: 3, klpCount: 12 } as never]}
        history={[]}
        captureSelfRating
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /start diagnostic/i }))
    const box = await screen.findByLabelText('Your answer')
    fireEvent.change(box, { target: { value: 'because' } })
    fireEvent.click(picker('Certain'))
    expect(checked('Certain')).toBe('true')

    fireEvent.change(box, { target: { value: '' } })
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.change(box, { target: { value: 'because of X' } })
    expect(checked('Certain')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: /submit diagnostic/i }))
    await waitFor(() => expect(h.submitDiagnosticTest).toHaveBeenCalledTimes(1))
    const sent = h.submitDiagnosticTest.mock.calls[0][0]
    expect(sent.answers[0].answer).toBe('because of X')
    expect(sent.answers[0].selfRating).toBeUndefined()
  })
})
