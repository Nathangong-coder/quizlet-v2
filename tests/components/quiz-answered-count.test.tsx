// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import type { Card } from '@prisma/client'

// RTL's auto-cleanup between tests relies on a global `afterEach`, which this
// repo doesn't register (vitest.config.ts has no `globals: true`) — without
// this, one test's rendered DOM bleeds into the next and a second render makes
// getByRole throw on multiple matches.
afterEach(cleanup)

// Every section component imports a 'use server' module. Importing one for
// real drags next-auth into jsdom and the file dies at load with "Cannot find
// module next/server", before any test runs — so the failure looks unrelated
// to whatever is being tested. Mock them all.
const h = vi.hoisted(() => ({
  getOrGenerateMultipleChoiceOptions: vi.fn(),
  submitMultipleChoiceAnswer: vi.fn(),
  submitShortAnswer: vi.fn(),
  submitTrueFalseAnswer: vi.fn(),
  getTrueFalseQuestion: vi.fn(),
  submitMatchingAnswers: vi.fn(),
}))

vi.mock('@/actions/quiz', () => ({
  getOrGenerateMultipleChoiceOptions: h.getOrGenerateMultipleChoiceOptions,
  submitMultipleChoiceAnswer: h.submitMultipleChoiceAnswer,
  submitShortAnswer: h.submitShortAnswer,
  submitTrueFalseAnswer: h.submitTrueFalseAnswer,
  getTrueFalseQuestion: h.getTrueFalseQuestion,
}))
vi.mock('@/actions/quiz-matching', () => ({
  submitMatchingAnswers: h.submitMatchingAnswers,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import type { QuizSectionHandle } from '@/components/quiz/section'
import { MultipleChoiceQuiz } from '@/components/quiz/MultipleChoiceQuiz'
import { ShortAnswerQuiz } from '@/components/quiz/ShortAnswerQuiz'
import { TrueFalseQuiz } from '@/components/quiz/TrueFalseQuiz'
import { MatchingQuiz } from '@/components/quiz/MatchingQuiz'

function card(id: string): Card {
  return {
    id,
    term: `Term ${id}`,
    definition: `Definition ${id}`,
    setId: 's1',
  } as unknown as Card
}

const cards = [card('c1'), card('c2')]

describe('QuizSectionHandle.answeredCount — multiple choice', () => {
  it('is 0 before the learner picks anything, and counts each pick', async () => {
    h.getOrGenerateMultipleChoiceOptions.mockResolvedValue({
      success: true,
      data: { options: ['A', 'B'], correctAnswer: 'A' },
    })
    const ref = createRef<QuizSectionHandle>()
    render(<MultipleChoiceQuiz ref={ref} cards={cards} attemptId="a1" />)

    expect(ref.current?.answeredCount()).toBe(0)

    const radios = await waitFor(() => {
      const found = screen.getAllByRole('radio')
      expect(found.length).toBeGreaterThan(0)
      return found
    })
    fireEvent.click(radios[0])
    await waitFor(() => expect(ref.current?.answeredCount()).toBe(1))
  })

  it('reports a FRESH count after answering a second question', async () => {
    // The handle is rebuilt from a dependency array. If `selectedAnswers` were
    // ever dropped from it, this stays at 1 — and downstream a stale 0 deletes
    // an attempt the learner really took.
    h.getOrGenerateMultipleChoiceOptions.mockResolvedValue({
      success: true,
      data: { options: ['A', 'B'], correctAnswer: 'A' },
    })
    const ref = createRef<QuizSectionHandle>()
    render(<MultipleChoiceQuiz ref={ref} cards={cards} attemptId="a1" />)

    const radios = await waitFor(() => {
      const found = screen.getAllByRole('radio')
      expect(found.length).toBeGreaterThan(0)
      return found
    })
    fireEvent.click(radios[0])
    await waitFor(() => expect(ref.current?.answeredCount()).toBe(1))

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    const nextRadios = await waitFor(() => {
      const found = screen.getAllByRole('radio')
      expect(found.length).toBeGreaterThan(0)
      return found
    })
    fireEvent.click(nextRadios[1])
    await waitFor(() => expect(ref.current?.answeredCount()).toBe(2))
  })
})

describe('QuizSectionHandle.answeredCount — short answer', () => {
  it('is 0 initially and ignores whitespace-only text', () => {
    const ref = createRef<QuizSectionHandle>()
    render(<ShortAnswerQuiz ref={ref} cards={cards} attemptId="a1" />)

    expect(ref.current?.answeredCount()).toBe(0)

    // Mirrors commitAll's own `.trim()` skip: a box holding only spaces is
    // never submitted, so it must not count as an answer either.
    const box = screen.getByPlaceholderText('Type your answer here...')
    fireEvent.change(box, { target: { value: '   ' } })
    expect(ref.current?.answeredCount()).toBe(0)

    fireEvent.change(box, { target: { value: 'a real answer' } })
    expect(ref.current?.answeredCount()).toBe(1)
  })
})

describe('QuizSectionHandle.answeredCount — true/false', () => {
  it('is 0 before a choice and 1 after', async () => {
    h.getTrueFalseQuestion.mockResolvedValue({
      success: true,
      data: { statement: 'A statement' },
    })
    const ref = createRef<QuizSectionHandle>()
    render(<TrueFalseQuiz ref={ref} cards={cards} attemptId="a1" />)

    expect(ref.current?.answeredCount()).toBe(0)

    const trueButton = await waitFor(() => {
      const b = screen.getByRole('button', { name: 'true' })
      expect(b).not.toBeDisabled()
      return b
    })
    fireEvent.click(trueButton)
    await waitFor(() => expect(ref.current?.answeredCount()).toBe(1))
  })
})

describe('QuizSectionHandle.answeredCount — matching', () => {
  it('is 0 before a pairing and counts each pair placed', () => {
    const ref = createRef<QuizSectionHandle>()
    render(<MatchingQuiz ref={ref} cards={cards} attemptId="a1" />)

    expect(ref.current?.answeredCount()).toBe(0)

    fireEvent.click(screen.getByText('Definition c1'))
    fireEvent.click(screen.getAllByText('Click to match...')[0])
    expect(ref.current?.answeredCount()).toBe(1)
  })
})
