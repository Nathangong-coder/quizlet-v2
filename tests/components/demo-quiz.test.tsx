// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const demoGrade = vi.fn()
const demoExtractPoints = vi.fn()
vi.mock('@/actions/demo', () => ({
  demoGrade: (...a: unknown[]) => demoGrade(...a),
  demoExtractPoints: (...a: unknown[]) => demoExtractPoints(...a),
}))
const promptCalls: { open: boolean; reason: string }[] = []
vi.mock('@/components/demo/WaitlistPrompt', () => ({
  WaitlistPrompt: (p: { open: boolean; reason: string }) => {
    promptCalls.push({ open: p.open, reason: p.reason })
    return null
  },
}))
vi.mock('@/components/quiz/GradeCard', () => ({ GradeCard: () => <div>grade-card</div> }))

import { DemoQuiz } from '@/components/demo/DemoQuiz'
import { DEMO_STORE_KEY } from '@/lib/demo/store'

const lastOpen = () => [...promptCalls].reverse().find((c) => c.open)
const cards = [
  {
    id: 'c1',
    term: 'What is EBITDA?',
    definition: 'Earnings before interest, tax, depreciation, amortization',
    categories: [{ name: 'accounting', color: null }],
    klps: [
      { id: 'k1', text: 'It is a profit measure' },
      { id: 'k2', text: 'It excludes interest and tax' },
    ],
  },
]
const SIGNED = { cardHash: 'h', points: [{ text: 'Generated point', weight: 3, kind: 'definition' }], sig: 's' }
const gradeData = (generatedPoints: boolean) => ({
  ok: true,
  data: {
    grade: { klpResults: [{ klpRef: 0, status: 'correct', evidence: 'a profit measure' }] },
    verdicts: [
      { klpId: 'k1', text: 'It is a profit measure', weight: 3, status: 'correct' },
      { klpId: 'k2', text: 'It excludes interest and tax', weight: 3, status: 'omission' },
    ],
    accuracy: 0.5,
    generatedPoints,
  },
})

function seedGuest(extra: Record<string, unknown> = {}) {
  window.localStorage.setItem(
    DEMO_STORE_KEY,
    JSON.stringify({
      set: { title: 'Mine', cards: [{ id: 'g1', term: 'My term', definition: 'My definition' }] },
      quizzesStarted: 0,
      used: {},
      ...extra,
    }),
  )
}

async function startQuiz(label = 'Demo set') {
  const btn = await screen.findByRole('button', { name: label })
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(btn)
  fireEvent.click(screen.getByRole('button', { name: 'Start quiz' }))
}
function typeAnswer(text: string) {
  fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: text } })
}

beforeEach(() => {
  window.localStorage.clear()
  promptCalls.length = 0
  demoGrade.mockReset()
  demoExtractPoints.mockReset()
})
afterEach(cleanup)

describe('DemoQuiz', () => {
  it('shows one question, no Next until graded, then verdicts and a prompt on Next', async () => {
    demoGrade.mockResolvedValue(gradeData(false))
    render(<DemoQuiz cards={cards} />)
    expect(await screen.findByText('Short answer, 1 question.', { exact: false })).toBeTruthy()
    await startQuiz()
    expect(screen.getByText('What is EBITDA?')).toBeTruthy()
    expect(screen.getAllByText('Question 1 of 1')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Next question' })).toBeNull()

    typeAnswer('a profit measure')
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await screen.findByText('grade-card')
    expect(demoGrade).toHaveBeenCalledWith({ kind: 'demo', cardId: 'c1', answer: 'a profit measure' })
    expect(screen.getByText('It excludes interest and tax')).toBeTruthy()
    expect(screen.getByText(/“a profit measure”/)).toBeTruthy()
    expect(screen.queryByText(/generated instantly/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Next question' }))
    expect(lastOpen()?.reason).toBe('questions')
  })

  it('extracts points for a guest card, warns, and grades against the returned points', async () => {
    seedGuest()
    demoExtractPoints.mockResolvedValue({ ok: true, data: SIGNED })
    demoGrade.mockResolvedValue(gradeData(true))
    render(<DemoQuiz cards={cards} />)
    await startQuiz('My cards')
    await screen.findByText('My term')
    expect(demoExtractPoints).toHaveBeenCalledWith({ card: { term: 'My term', definition: 'My definition' } })
    const warning = 'These key points were generated instantly for your card. In the full app, key points are written and tested against deliberately wrong answers before they’re used for grading, so expect these to be rougher.'
    expect(screen.getByRole('note').textContent?.replace(/\s+/g, ' ')).toBe(warning.replace('’', "'"))

    typeAnswer('my answer')
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await screen.findByText('grade-card')
    expect(demoGrade).toHaveBeenCalledWith({
      kind: 'guest',
      card: { term: 'My term', definition: 'My definition' },
      points: SIGNED,
      answer: 'my answer',
    })
    expect(screen.getAllByRole('note')).toHaveLength(2)
    const stored = JSON.parse(window.localStorage.getItem(DEMO_STORE_KEY)!)
    expect(stored.set.cards[0].points).toEqual(SIGNED)
    expect(stored.used['klp-extract']).toBe(true)
  })

  it('does not spend the quiz when extraction fails; a retry then starts it', async () => {
    seedGuest()
    demoExtractPoints.mockResolvedValueOnce({ ok: false, reason: 'ai_failed', message: 'x' })
    demoExtractPoints.mockResolvedValueOnce({ ok: true, data: SIGNED })
    render(<DemoQuiz cards={cards} />)
    await startQuiz('My cards')
    expect((await screen.findByRole('alert')).textContent).toBe('The demo is having trouble. Try again.')
    expect(screen.queryByLabelText('Your answer')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(DEMO_STORE_KEY)!).quizzesStarted).toBe(0)
    expect(lastOpen()).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Start quiz' }))
    await screen.findByLabelText('Your answer')
    expect(lastOpen()).toBeUndefined()
    expect(JSON.parse(window.localStorage.getItem(DEMO_STORE_KEY)!).quizzesStarted).toBe(1)
  })

  it('opens the prompt with quizzes on a second New quiz', async () => {
    demoGrade.mockResolvedValue(gradeData(false))
    render(<DemoQuiz cards={cards} />)
    await startQuiz()
    typeAnswer('x')
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await screen.findByText('grade-card')
    fireEvent.click(screen.getByRole('button', { name: 'New quiz' }))
    expect(lastOpen()?.reason).toBe('quizzes')
  })

  it('refuses a quiz start past the limit with the quizzes prompt', async () => {
    seedGuest({ quizzesStarted: 1 })
    render(<DemoQuiz cards={cards} />)
    await startQuiz()
    expect(lastOpen()?.reason).toBe('quizzes')
    expect(screen.queryByLabelText('Your answer')).toBeNull()
  })

  it('keeps the typed answer and shows the retry message on ai_failed', async () => {
    demoGrade.mockResolvedValue({ ok: false, reason: 'ai_failed', message: 'The demo is having trouble. Try again.' })
    render(<DemoQuiz cards={cards} />)
    await startQuiz()
    typeAnswer('my careful answer')
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The demo is having trouble. Try again.')
    expect((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value).toBe('my careful answer')
    expect(lastOpen()).toBeUndefined()
  })

  it('opens the prompt with demo_cap', async () => {
    demoGrade.mockResolvedValue({ ok: false, reason: 'demo_cap', message: 'busy' })
    render(<DemoQuiz cards={cards} />)
    await startQuiz()
    typeAnswer('x')
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await waitFor(() => expect(lastOpen()?.reason).toBe('demo_cap'))
  })

  it('marks grade used after a server quota_used and stops re-calling', async () => {
    demoGrade.mockResolvedValue({ ok: false, reason: 'quota_used', message: 'used' })
    render(<DemoQuiz cards={cards} />)
    await startQuiz()
    typeAnswer('x')
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    await waitFor(() => expect(lastOpen()?.reason).toBe('quota_used'))
    expect(JSON.parse(window.localStorage.getItem(DEMO_STORE_KEY)!).used.grade).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect(demoGrade).toHaveBeenCalledTimes(1)
  })

  it('shows demo_off inline instead of the prompt', async () => {
    demoGrade.mockResolvedValue({ ok: false, reason: 'demo_off', message: 'The demo is switched off right now.' })
    render(<DemoQuiz cards={cards} />)
    await startQuiz()
    typeAnswer('x')
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The demo is switched off right now.')
    expect(lastOpen()).toBeUndefined()
  })

  it('disables My cards when the guest has none', async () => {
    render(<DemoQuiz cards={cards} />)
    const btn = (await screen.findByRole('button', { name: 'My cards' })) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
