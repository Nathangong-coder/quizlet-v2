// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'

afterEach(cleanup)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const h = vi.hoisted(() => ({
  recordReview: vi.fn(),
  starCard: vi.fn(),
  startStudySession: vi.fn(),
  finishStudySession: vi.fn(),
}))
vi.mock('@/actions/confidence', () => ({ recordReview: h.recordReview, starCard: h.starCard }))
vi.mock('@/actions/study-session', () => ({ startStudySession: h.startStudySession, finishStudySession: h.finishStudySession }))

import { ReviewMode } from '@/components/review/ReviewMode'

const NOW = 5_000_000
const cards = [
  { id: 'a', term: 'Alpha', definition: 'first', confidence: 8, starred: true, dueAt: NOW + 1, categoryIds: [] },
  { id: 'b', term: 'Beta', definition: 'second', confidence: 3, starred: false, dueAt: null, categoryIds: ['cat'] },
  { id: 'c', term: 'Gamma', definition: 'third', confidence: 5, starred: false, dueAt: null, categoryIds: [] },
]
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

beforeEach(() => {
  vi.clearAllMocks()
  h.recordReview.mockResolvedValue({ newConfidence: 5 })
  h.starCard.mockResolvedValue(undefined)
  h.startStudySession.mockResolvedValue({ success: true, data: { sessionId: 'ss1' } })
  h.finishStudySession.mockResolvedValue({ success: true, data: {} })
})

describe('ReviewMode', () => {
  it('sets up a deck — filters change the count on the button — then runs it and summarizes', async () => {
    render(<ReviewMode cards={cards} categories={[{ id: 'cat', name: 'Talking', color: null }]} setId="s1" now={NOW} />)
    expect(screen.getByRole('button', { name: /start review · 3 cards/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /starred/i }))
    expect(screen.getByRole('button', { name: /start review · 1 card$/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /starred/i }))
    fireEvent.click(screen.getByRole('button', { name: /weak/i }))
    expect(screen.getByRole('button', { name: /start review · 1 card$/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /weak/i }))
    fireEvent.click(screen.getByRole('radio', { name: /definition/i }))
    fireEvent.click(screen.getByRole('button', { name: /start review · 3 cards/i }))

    // Definition first, as chosen; the card is flat and flips on click.
    expect(screen.getByText('first')).toBeTruthy()
    expect(screen.getByRole('button', { name: /don.t know/i })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: /show term/i }))
    expect(screen.getByText('Alpha')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /know it/i }))
    await tick()
    expect(h.recordReview).toHaveBeenCalledWith('a', true, expect.objectContaining({ sessionId: 'ss1' }))

    // Keyboard: space flips, 1 = don't know. Beta comes back later.
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: '1' })
    await tick()
    expect(h.recordReview).toHaveBeenLastCalledWith('b', false, expect.anything())
    // Star from the keyboard on Gamma.
    fireEvent.keyDown(window, { key: 's' })
    await tick()
    expect(h.starCard).toHaveBeenCalledWith('c', 's1', true)
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: '2' })
    await tick()
    // Beta again — this time known.
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: '2' })
    await tick()

    expect(screen.getByText(/review complete/i)).toBeTruthy()
    expect(h.finishStudySession).toHaveBeenCalledWith({ sessionId: 'ss1' })
    const missed = screen.getByText(/the ones you missed/i).parentElement!
    expect(within(missed).getByText('Beta')).toBeTruthy()
    // "Review the 1 you missed" restarts with only Beta.
    fireEvent.click(screen.getByRole('button', { name: /review the 1 you missed/i }))
    expect(screen.getByText('0 of 1 done')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()
    expect(screen.queryByText('first')).toBeNull()
  })
})
