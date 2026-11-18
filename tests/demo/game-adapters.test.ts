import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/actions/demo', () => ({
  demoGauntletRun: vi.fn(),
  demoGauntletOptions: vi.fn(),
  demoGradeGameAnswer: vi.fn(),
  demoStartHotSeat: vi.fn(),
  demoProbeHotSeat: vi.fn(),
}))

import * as demo from '@/actions/demo'
import { makeDemoGauntletApi, makeDemoHotSeatApi } from '@/lib/demo/game-adapters'

beforeEach(() => vi.clearAllMocks())

describe('demo game adapters', () => {
  it('maps ok results to success results', async () => {
    vi.mocked(demo.demoGauntletOptions).mockResolvedValue({ ok: true, data: { options: ['a'], correct: 'a', source: 'ai' } })
    const api = makeDemoGauntletApi(vi.fn())
    expect(await api.options('c1', 'term')).toEqual({ success: true, data: { options: ['a'], correct: 'a', source: 'ai' } })
  })

  it('quota_used fails with the message and calls onRefused', async () => {
    vi.mocked(demo.demoGauntletRun).mockResolvedValue({ ok: false, reason: 'quota_used', message: "You've used this in the demo." })
    const onRefused = vi.fn()
    const res = await makeDemoGauntletApi(onRefused).buildRun('s', 'mc')
    expect(res).toEqual({ success: false, error: "You've used this in the demo." })
    expect(onRefused).toHaveBeenCalledWith('quota_used')
  })

  it('demo_cap on Hot Seat calls onRefused; other failures do not', async () => {
    const onRefused = vi.fn()
    const api = makeDemoHotSeatApi(onRefused)
    vi.mocked(demo.demoStartHotSeat).mockResolvedValue({ ok: false, reason: 'demo_cap', message: 'busy' })
    await api.start('s', 'normal')
    expect(onRefused).toHaveBeenCalledWith('demo_cap')
    onRefused.mockClear()
    vi.mocked(demo.demoGradeGameAnswer).mockResolvedValue({ ok: false, reason: 'ai_failed', message: 'try again' })
    expect(await api.grade('c', 'a')).toEqual({ success: false, error: 'try again' })
    expect(onRefused).not.toHaveBeenCalled()
  })

  it('submitScore makes no action call', async () => {
    const g = makeDemoGauntletApi(vi.fn())
    const h = makeDemoHotSeatApi(vi.fn())
    const input = { setId: 's', game: 'gauntlet', mode: 'mc', score: 1 } as never
    expect(await g.submitScore(input)).toEqual({ success: true, data: { saved: false } })
    expect(await h.submitScore(input)).toEqual({ success: true, data: { saved: false } })
    for (const fn of Object.values(demo)) expect(fn).not.toHaveBeenCalled()
  })
})
