// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

afterEach(cleanup)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/actions/games', () => ({
  buildGauntletRun: vi.fn(),
  gauntletOptions: vi.fn(),
  gradeGameAnswer: vi.fn(),
  submitGameScore: vi.fn(),
  startHotSeat: vi.fn(),
  probeHotSeat: vi.fn(),
}))

import * as actions from '@/actions/games'
import { GauntletGame } from '@/components/games/GauntletGame'
import { HotSeatGame } from '@/components/games/HotSeatGame'
import type { GauntletApi, HotSeatApi } from '@/lib/games/api'

const fail = { success: false as const, error: 'nope' }

beforeEach(() => vi.clearAllMocks())

describe('GauntletGame api injection', () => {
  it('uses the injected api, not the real actions', async () => {
    const fake: GauntletApi = { buildRun: vi.fn().mockResolvedValue(fail), options: vi.fn(), grade: vi.fn(), submitScore: vi.fn() }
    render(<GauntletGame setId="s1" signedIn={false} api={fake} />)
    fireEvent.click(screen.getByRole('button', { name: /enter the gauntlet/i }))
    await waitFor(() => expect(fake.buildRun).toHaveBeenCalledWith('s1', 'mc'))
    expect(actions.buildGauntletRun).not.toHaveBeenCalled()
  })

  it('defaults to the real actions', async () => {
    vi.mocked(actions.buildGauntletRun).mockResolvedValue(fail)
    render(<GauntletGame setId="s1" signedIn={false} />)
    fireEvent.click(screen.getByRole('button', { name: /enter the gauntlet/i }))
    await waitFor(() => expect(actions.buildGauntletRun).toHaveBeenCalledWith('s1', { mode: 'mc' }))
  })

  it('shows aiLabel in place of the credential note', () => {
    render(<GauntletGame setId="s1" signedIn aiLabel="Graded on the demo's keys." />)
    expect(screen.getByText("Graded on the demo's keys.")).toBeTruthy()
    expect(screen.queryByText(/uses your ai credentials/i)).toBeNull()
  })
})

describe('HotSeatGame api injection', () => {
  it('uses the injected api, not the real actions', async () => {
    const fake: HotSeatApi = { start: vi.fn().mockResolvedValue(fail), grade: vi.fn(), probe: vi.fn(), submitScore: vi.fn() }
    render(<HotSeatGame setId="s1" signedIn api={fake} />)
    fireEvent.click(screen.getByRole('button', { name: /take the hot seat/i }))
    await waitFor(() => expect(fake.start).toHaveBeenCalledWith('s1', 'normal'))
    expect(actions.startHotSeat).not.toHaveBeenCalled()
  })

  it('defaults to the real actions', async () => {
    vi.mocked(actions.startHotSeat).mockResolvedValue(fail)
    render(<HotSeatGame setId="s1" signedIn />)
    fireEvent.click(screen.getByRole('button', { name: /take the hot seat/i }))
    await waitFor(() => expect(actions.startHotSeat).toHaveBeenCalledWith('s1', 'normal'))
  })

  it('shows aiLabel in place of the credential note', () => {
    render(<HotSeatGame setId="s1" signedIn aiLabel="Demo interviewer." />)
    expect(screen.getByText('Demo interviewer.')).toBeTruthy()
    expect(screen.queryByText(/uses your ai credentials/i)).toBeNull()
  })

  it('shows the credential note without aiLabel', () => {
    render(<HotSeatGame setId="s1" signedIn />)
    expect(screen.getByText(/uses your ai credentials/i)).toBeTruthy()
  })

  it('shows the difficulty picker by default', () => {
    render(<HotSeatGame setId="s1" signedIn />)
    expect(screen.getByText('Difficulty')).toBeTruthy()
  })

  it('lockedMode hides the picker and plays that mode', async () => {
    const fake: HotSeatApi = { start: vi.fn().mockResolvedValue(fail), grade: vi.fn(), probe: vi.fn(), submitScore: vi.fn() }
    render(<HotSeatGame setId="s1" signedIn api={fake} lockedMode="hard" />)
    expect(screen.queryByText('Difficulty')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /take the hot seat/i }))
    await waitFor(() => expect(fake.start).toHaveBeenCalledWith('s1', 'hard'))
  })
})
