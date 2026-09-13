// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

afterEach(cleanup)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/actions/games', () => ({
  buildGauntletRun: vi.fn(),
  gradeGameAnswer: vi.fn(),
  startHotSeat: vi.fn(),
  probeHotSeat: vi.fn(),
  prepareGamePieces: vi.fn(),
  setGamePieceEnabled: vi.fn(),
}))

import { BlitzGame } from '@/components/games/BlitzGame'
import { CrosswordGame } from '@/components/games/CrosswordGame'

const words = ['capital', 'debt', 'equity', 'asset', 'cash', 'margin', 'revenue', 'goodwill', 'tax', 'leverage', 'yield', 'bond', 'ratio', 'accrual', 'liability']
const pieces = words.map((w, i) => ({ id: `p${i}`, cardId: 'c', klpId: null, kind: 'cloze', prompt: `clue for ${w} ___`, answer: w, aliases: [], enabled: true }))

beforeEach(() => {
  let raf = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { raf += 1; setTimeout(() => cb(performance.now()), 16); return raf })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

describe('BlitzGame', () => {
  it('starts, spawns a block with four tiles, and a correct tap scores', async () => {
    render(<BlitzGame setId="s1" pieces={pieces} />)
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    const tiles = screen.getAllByRole('button').filter((b) => words.includes(b.textContent ?? ''))
    expect(tiles).toHaveLength(4)
    const board = screen.getByRole('img', { name: /falling prompts/i })
    const prompt = board.textContent!.match(/clue for (\w+) ___/)![1]
    fireEvent.click(tiles.find((t) => t.textContent === prompt)!)
    expect(screen.getByText('10')).toBeTruthy()
  })
})

describe('CrosswordGame', () => {
  it('lays out a grid, accepts typing, and checks', () => {
    render(<CrosswordGame setId="s1" pieces={pieces} />)
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }))
    const grid = screen.getByRole('grid', { name: /crossword grid/i })
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(20)
    fireEvent.keyDown(grid, { key: 'z' })
    expect(screen.getAllByRole('gridcell').some((c) => c.textContent?.includes('z'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /check/i }))
    expect(document.querySelector('.text-rose-600')).not.toBeNull()
  })

  it('says so when the pool is too thin', () => {
    render(<CrosswordGame setId="s1" pieces={pieces.slice(0, 4)} />)
    expect(screen.getByText(/not enough short answers/i)).toBeTruthy()
  })
})
