// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'

afterEach(cleanup)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const h = vi.hoisted(() => ({
  buildGauntletRun: vi.fn(),
  gauntletOptions: vi.fn(),
  gradeGameAnswer: vi.fn(),
  startHotSeat: vi.fn(),
  probeHotSeat: vi.fn(),
  submitGameScore: vi.fn(),
}))
vi.mock('@/actions/games', () => h)

import { GauntletGame } from '@/components/games/GauntletGame'
import { HotSeatGame } from '@/components/games/HotSeatGame'
import { planRun, MAX_HP, ENEMIES } from '@/lib/games/gauntlet'
import { DEFAULT_PERSONA } from '@/lib/games/personas'

const cards = Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, term: `Term ${i}`, definition: `Definition ${i}` }))
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

beforeEach(() => {
  vi.clearAllMocks()
  h.submitGameScore.mockResolvedValue({ success: true, data: { saved: true } })
})

/**
 * The signed-in games cannot be reached from an agent's browser session, so
 * the screens the owner asked for are pinned here: characters on screen, an
 * HP bar with no lives, the magician's choice, the two modes, and a Hot Seat
 * that shows the host's face and the follow-up — never the missed points.
 */
describe('GauntletGame', () => {
  function mockRun() {
    const plan = planRun({ cards, memory: [], seed: 5, mode: 'mc' })
    h.buildGauntletRun.mockResolvedValue({ success: true, data: { ...plan, cards } })
    h.gauntletOptions.mockImplementation(async (cardId: string, ask: 'term' | 'definition') => {
      const c = cards.find((x) => x.id === cardId)!
      const correct = ask === 'definition' ? c.definition : c.term
      return { success: true, data: { options: [correct, 'wrong A', 'wrong B', 'wrong C'], correct, source: 'ai' } }
    })
    return plan
  }

  it('shows the knight and an enemy, an HP bar and no lives; a hit scores, a miss costs HP', async () => {
    const plan = mockRun()
    render(<GauntletGame setId="s1" signedIn />)
    expect(screen.getByRole('radio', { name: /multiple choice/i })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /short answer/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /enter the gauntlet/i }))
    await tick()
    expect(h.buildGauntletRun).toHaveBeenCalledWith('s1', { mode: 'mc' })
    expect(screen.getByRole('img', { name: `${MAX_HP} of ${MAX_HP} HP` })).toBeTruthy()
    expect(screen.queryByText(/lives/i)).toBeNull()
    expect(screen.getByRole('img', { name: /you, the knight/i })).toBeTruthy()
    expect(screen.getAllByRole('img', { name: new RegExp(ENEMIES[plan.encounters[0].kind].name, 'i') }).length).toBeGreaterThan(0)

    // Wrong answer: the enemy's damage comes off the bar, and the missed card
    // is reviewed in full before a DIFFERENT question is asked.
    const first = cards.find((c) => c.id === plan.encounters[0].cardId)!
    fireEvent.click(screen.getByRole('button', { name: 'wrong A' }))
    await tick()
    const dmg = ENEMIES[plan.encounters[0].kind].damage
    expect(screen.getByRole('img', { name: `${MAX_HP - dmg} of ${MAX_HP} HP` })).toBeTruthy()
    const review = screen.getByRole('region', { name: /review the card you missed/i })
    expect(within(review).getByText(first.term)).toBeTruthy()
    expect(within(review).getByText(first.definition)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'wrong A' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await tick()
    // The enemy still stands, asking a card from the pool.
    expect(h.gauntletOptions).toHaveBeenCalledTimes(2)
    const swapped = h.gauntletOptions.mock.calls[1][0] as string
    expect(swapped).not.toBe(first.id)
    expect(swapped).toBe(plan.pool[0])

    // Right answer: a strike, and the next enemy's options are fetched.
    const now = cards.find((c) => c.id === swapped)!
    const ask = h.gauntletOptions.mock.calls[1][1] as 'term' | 'definition'
    const correct = ask === 'definition' ? now.definition : now.term
    fireEvent.click(screen.getByRole('button', { name: correct }))
    await tick()
    expect(screen.getByText(/a clean strike/i)).toBeTruthy()
    expect(h.gauntletOptions).toHaveBeenCalledTimes(3)
  })

  it('after three kills the magician offers heal or weaken', async () => {
    const plan = mockRun()
    render(<GauntletGame setId="s1" signedIn />)
    fireEvent.click(screen.getByRole('button', { name: /enter the gauntlet/i }))
    await tick()
    for (let i = 0; i < 3; i++) {
      const c = cards.find((x) => x.id === plan.encounters[i].cardId)!
      const correct = plan.encounters[i].ask === 'definition' ? c.definition : c.term
      fireEvent.click(screen.getByRole('button', { name: correct }))
      await tick()
    }
    expect(screen.getByRole('img', { name: /magician/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /heal 15 hp/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /weaken the next enemy/i }))
    await tick()
    expect(screen.getByText(/cursed/i)).toBeTruthy()
  })

  it('short answer: the grade’s accuracy is the chance to hit, shown as a tag', async () => {
    const plan = planRun({ cards, memory: [], seed: 5, mode: 'sa' })
    h.buildGauntletRun.mockResolvedValue({ success: true, data: { ...plan, cards } })
    h.gradeGameAnswer.mockResolvedValue({ success: true, data: { hit: true, accuracy: 1, verdicts: [] } })
    render(<GauntletGame setId="s1" signedIn />)
    fireEvent.click(screen.getByRole('radio', { name: /short answer/i }))
    fireEvent.click(screen.getByRole('button', { name: /enter the gauntlet/i }))
    await tick()
    expect(h.buildGauntletRun).toHaveBeenCalledWith('s1', { mode: 'sa' })
    expect(h.gauntletOptions).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my answer' } })
    fireEvent.submit(screen.getByRole('textbox').closest('form')!)
    await tick()
    expect(h.gradeGameAnswer).toHaveBeenCalledWith(plan.encounters[0].cardId, 'my answer')
    expect(screen.getByText(/100% to hit — it lands/i)).toBeTruthy()
  })
})

describe('HotSeatGame', () => {
  it('shows the host’s face and the follow-up, never the missed point; rounds follow the mode', async () => {
    h.startHotSeat.mockResolvedValue({ success: true, data: { cards: cards.slice(0, 7), persona: DEFAULT_PERSONA, costume: 'science' } })
    h.gradeGameAnswer.mockResolvedValue({
      success: true,
      data: { hit: false, accuracy: 0.2, verdicts: [{ klpId: 'k1', text: 'SECRET missed point', weight: 5, status: 'failed' }, { klpId: 'k2', text: 'a passed point', weight: 1, status: 'passed' }] },
    })
    h.probeHotSeat.mockResolvedValue({ success: true, data: { question: 'Say more about the mechanism?' } })
    render(<HotSeatGame setId="s1" signedIn />)
    fireEvent.click(screen.getByRole('radio', { name: /hard/i }))
    fireEvent.click(screen.getByRole('button', { name: /take the hot seat/i }))
    await tick()
    expect(h.startHotSeat).toHaveBeenCalledWith('s1', 'hard')
    expect(screen.getByText(/question 1 of 7/i)).toBeTruthy()
    expect(screen.getByText(/90s/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /neutral/i })).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'an answer' } })
    fireEvent.submit(screen.getByRole('textbox').closest('form')!)
    await tick()
    // The face reacts and the follow-up appears…
    expect(screen.getByRole('img', { name: /annoyed/i })).toBeTruthy()
    expect(screen.getByText(/say more about the mechanism/i)).toBeTruthy()
    // …but the missed key point is never on screen.
    expect(screen.queryByText(/SECRET missed point/)).toBeNull()
    expect(screen.queryByText(/a passed point/)).toBeNull()
  })

  it('an easy interview is four rounds and the verdict saves a mood score', async () => {
    h.startHotSeat.mockResolvedValue({ success: true, data: { cards: cards.slice(0, 4), persona: DEFAULT_PERSONA, costume: 'default' } })
    h.gradeGameAnswer.mockResolvedValue({ success: true, data: { hit: true, accuracy: 1, verdicts: [{ klpId: 'k1', text: 'p', weight: 5, status: 'passed' }] } })
    render(<HotSeatGame setId="s1" signedIn />)
    fireEvent.click(screen.getByRole('radio', { name: /easy/i }))
    fireEvent.click(screen.getByRole('button', { name: /take the hot seat/i }))
    await tick()
    for (let i = 0; i < 4; i++) {
      expect(screen.getByText(new RegExp(`question ${i + 1} of 4`, 'i'))).toBeTruthy()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'an answer' } })
      fireEvent.submit(screen.getByRole('textbox').closest('form')!)
      await tick()
      fireEvent.click(screen.getByRole('button', { name: i === 3 ? /see the verdict/i : /next question/i }))
      await tick()
    }
    expect(h.submitGameScore).toHaveBeenCalledWith(expect.objectContaining({ game: 'hot-seat', mode: 'easy', setId: 's1' }))
    expect(screen.getByText(/saved to the leaderboard/i)).toBeTruthy()
    // The end-screen transcript may name points; the interview itself never did.
    expect(within(document.body).getByText(/nothing here was saved to your memory/i)).toBeTruthy()
  })
})
