// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

// Spec 6 §3.2 / D6: Review rates BEFORE the flip (prospective), keys 1-4
// pre-flip; after the flip the rating is frozen and 1/2 keep their answer
// meaning. The two meanings of "2" are never live at the same time.

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

import ReviewSession from '@/components/review/ReviewSession'

const cards = [
  { id: 'a', term: 'Alpha', definition: 'first', confidence: 8, starred: false, dueAt: null, categoryIds: [] },
  { id: 'b', term: 'Beta', definition: 'second', confidence: 3, starred: false, dueAt: null, categoryIds: [] },
]
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

beforeEach(() => {
  vi.clearAllMocks()
  h.recordReview.mockResolvedValue({ newConfidence: 5 })
  h.starCard.mockResolvedValue(undefined)
  h.startStudySession.mockResolvedValue({ success: true, data: { sessionId: 'ss1' } })
  h.finishStudySession.mockResolvedValue({ success: true, data: {} })
})

function checked() {
  return screen.getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))
}

describe('ReviewSession self-rating', () => {
  it('pre-flip "2" selects rating 2 and does not answer; post-flip "2" answers Know It with the rating frozen', async () => {
    render(<ReviewSession cards={cards} setId="s1" />)
    expect(screen.getByRole('radiogroup', { name: 'Do you know this one?' })).toBeTruthy()
    expect(checked()).toEqual(['false', 'false', 'false', 'false'])

    fireEvent.keyDown(window, { key: '2' })
    await tick()
    expect(checked()).toEqual(['false', 'true', 'false', 'false'])
    expect(h.recordReview).not.toHaveBeenCalled()
    // Still on Alpha, unflipped.
    expect(screen.getByText('Alpha')).toBeTruthy()

    // Flip. The picker freezes: a rating key no longer changes it...
    fireEvent.keyDown(window, { key: ' ' })
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(window, { key: '4' })
    await tick()
    expect(checked()).toEqual(['false', 'true', 'false', 'false'])

    // ...and "2" now means Know It, carrying the frozen rating.
    fireEvent.keyDown(window, { key: '2' })
    await tick()
    expect(h.recordReview).toHaveBeenCalledTimes(1)
    expect(h.recordReview).toHaveBeenCalledWith('a', true, expect.objectContaining({ selfRating: 2 }))

    // Next card: nothing pre-selected — the rating resets per card.
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(checked()).toEqual(['false', 'false', 'false', 'false'])
  })

  it('an unrated card answers with no selfRating', async () => {
    render(<ReviewSession cards={cards} setId="s1" />)
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: '1' })
    await tick()
    expect(h.recordReview).toHaveBeenCalledTimes(1)
    const opts = h.recordReview.mock.calls[0][2]
    expect(opts.selfRating).toBeUndefined()
  })

  it('clicking a rating works too, and the key hints never show both meanings of 2 at once', () => {
    render(<ReviewSession cards={cards} setId="s1" />)
    // Pre-flip: the picker hints (1-4) are visible, the answer hints are not.
    expect(screen.getByRole('radio', { name: 'Unsure' }).textContent).toContain('2')
    expect(screen.getByRole('button', { name: /know it/i }).textContent).not.toContain('2')
    fireEvent.click(screen.getByRole('radio', { name: 'Certain' }))
    expect(checked()).toEqual(['false', 'false', 'false', 'true'])
    // Post-flip: the answer hints are visible, the picker hints are not.
    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByRole('button', { name: /know it/i }).textContent).toContain('2')
    expect(screen.getByRole('radio', { name: 'Unsure' }).textContent).not.toContain('2')
  })

  it('captureSelfRating=false hides the picker, and 1-4 pre-flip do nothing', async () => {
    render(<ReviewSession cards={cards} setId="s1" captureSelfRating={false} />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.keyDown(window, { key: '3' })
    await tick()
    expect(h.recordReview).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: '2' })
    await tick()
    expect(h.recordReview).toHaveBeenCalledWith('a', true, expect.not.objectContaining({ selfRating: expect.anything() }))
  })
})
