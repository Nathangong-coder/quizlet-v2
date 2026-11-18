// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { GauntletApi, HotSeatApi } from '@/lib/games/api'

/**
 * The demo game wrappers keep the guest's local allowance in step with the
 * server: a started run, or a server quota_used, marks the game used; an
 * ip_limit (never served) opens the prompt and marks nothing.
 */
const h = vi.hoisted(() => ({
  demoGauntletRun: vi.fn(),
  demoStartHotSeat: vi.fn(),
  gauntletApi: null as GauntletApi | null,
  hotSeatApi: null as HotSeatApi | null,
  promptCalls: [] as { open: boolean; reason: string }[],
}))

vi.mock('@/actions/demo', () => ({
  demoGauntletRun: (...a: unknown[]) => h.demoGauntletRun(...a),
  demoGauntletOptions: vi.fn(),
  demoGradeGameAnswer: vi.fn(),
  demoStartHotSeat: (...a: unknown[]) => h.demoStartHotSeat(...a),
  demoProbeHotSeat: vi.fn(),
}))
vi.mock('@/components/games/GauntletGame', () => ({
  GauntletGame: (p: { api: GauntletApi }) => {
    h.gauntletApi = p.api
    return null
  },
}))
vi.mock('@/components/games/HotSeatGame', () => ({
  HotSeatGame: (p: { api: HotSeatApi }) => {
    h.hotSeatApi = p.api
    return null
  },
}))
vi.mock('@/components/demo/WaitlistPrompt', () => ({
  WaitlistPrompt: (p: { open: boolean; reason: string }) => {
    h.promptCalls.push({ open: p.open, reason: p.reason })
    return null
  },
}))

import { DemoGauntlet } from '@/components/demo/DemoGauntlet'
import { DemoHotSeat } from '@/components/demo/DemoHotSeat'
import { DEMO_STORE_KEY } from '@/lib/demo/store'

const stored = () => JSON.parse(window.localStorage.getItem(DEMO_STORE_KEY) ?? '{"used":{}}')
const lastOpen = () => [...h.promptCalls].reverse().find((c) => c.open)

beforeEach(() => {
  window.localStorage.clear()
  h.promptCalls.length = 0
  h.gauntletApi = null
  h.hotSeatApi = null
  h.demoGauntletRun.mockReset()
  h.demoStartHotSeat.mockReset()
})
afterEach(cleanup)

describe('DemoGauntlet', () => {
  it('marks gauntlet used when a run starts', async () => {
    h.demoGauntletRun.mockResolvedValue({ ok: true, data: { cards: [] } })
    render(<DemoGauntlet setId="s" />)
    await waitFor(() => expect(h.gauntletApi).not.toBeNull())
    const res = await act(() => h.gauntletApi!.buildRun('s', 'mc'))
    expect(res.success).toBe(true)
    expect(stored().used.gauntlet).toBe(true)
  })

  it('marks gauntlet used and opens the prompt on a server quota_used', async () => {
    h.demoGauntletRun.mockResolvedValue({ ok: false, reason: 'quota_used', message: "You've used this in the demo." })
    render(<DemoGauntlet setId="s" />)
    await waitFor(() => expect(h.gauntletApi).not.toBeNull())
    await act(() => h.gauntletApi!.buildRun('s', 'mc'))
    expect(stored().used.gauntlet).toBe(true)
    expect(lastOpen()?.reason).toBe('quota_used')
  })

  it('an ip_limit refusal opens the prompt and marks nothing', async () => {
    h.demoGauntletRun.mockResolvedValue({ ok: false, reason: 'ip_limit', message: 'Too many tries' })
    render(<DemoGauntlet setId="s" />)
    await waitFor(() => expect(h.gauntletApi).not.toBeNull())
    await act(() => h.gauntletApi!.buildRun('s', 'mc'))
    expect(stored().used.gauntlet).toBeUndefined()
    expect(lastOpen()?.reason).toBe('ip_limit')
  })
})

describe('DemoHotSeat', () => {
  it('marks hot-seat used when a run starts', async () => {
    h.demoStartHotSeat.mockResolvedValue({ ok: true, data: { cards: [], persona: {}, costume: '' } })
    render(<DemoHotSeat setId="s" />)
    await waitFor(() => expect(h.hotSeatApi).not.toBeNull())
    const res = await act(() => h.hotSeatApi!.start('s', 'normal'))
    expect(res.success).toBe(true)
    expect(stored().used['hot-seat']).toBe(true)
  })

  it('marks hot-seat used and opens the prompt on a server quota_used', async () => {
    h.demoStartHotSeat.mockResolvedValue({ ok: false, reason: 'quota_used', message: "You've used this in the demo." })
    render(<DemoHotSeat setId="s" />)
    await waitFor(() => expect(h.hotSeatApi).not.toBeNull())
    await act(() => h.hotSeatApi!.start('s', 'normal'))
    expect(stored().used['hot-seat']).toBe(true)
    expect(lastOpen()?.reason).toBe('quota_used')
  })

  it('a failed start that is not a quota refusal marks nothing', async () => {
    h.demoStartHotSeat.mockResolvedValue({ ok: false, reason: 'ai_failed', message: 'try again' })
    render(<DemoHotSeat setId="s" />)
    await waitFor(() => expect(h.hotSeatApi).not.toBeNull())
    await act(() => h.hotSeatApi!.start('s', 'normal'))
    expect(stored().used['hot-seat']).toBeUndefined()
    expect(lastOpen()).toBeUndefined()
  })
})
