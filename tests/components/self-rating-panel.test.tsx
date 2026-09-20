// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'

afterEach(cleanup)

const h = vi.hoisted(() => ({ loadTuning: vi.fn(), saveTuning: vi.fn() }))
vi.mock('@/actions/learner-tuning', () => ({
  loadTuning: h.loadTuning,
  saveTuning: h.saveTuning,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import SelfRatingPanel from '@/components/settings/SelfRatingPanel'

const STORED = {
  strategy: 'balanced' as const,
  bandOverrides: {},
  thresholdOverrides: {},
  studyScope: { setIds: [], categoryKeys: [] },
  captureSelfRating: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.loadTuning.mockResolvedValue({ success: true, data: STORED })
  h.saveTuning.mockResolvedValue({ success: true, data: { ...STORED, captureSelfRating: false } })
})

describe('SelfRatingPanel', () => {
  it('renders one switch, checked from the loaded value, and the two sentences', async () => {
    render(<SelfRatingPanel />)
    const sw = await screen.findByRole('switch')
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))
    expect(screen.getAllByRole('switch')).toHaveLength(1)
    // What it is for.
    expect(screen.getByText(/how sure you are/i)).toBeTruthy()
    // Turning it off records nothing and cannot be backfilled.
    expect(screen.getByText(/cannot be backfilled/i)).toBeTruthy()
  })

  it('flipping the switch saves ONLY captureSelfRating', async () => {
    render(<SelfRatingPanel />)
    const sw = await screen.findByRole('switch')
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(sw)
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalledTimes(1))
    expect(h.saveTuning.mock.calls[0][0]).toEqual({ captureSelfRating: false })
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'))
  })

  it('a failed save reverts the switch', async () => {
    h.saveTuning.mockResolvedValue({ success: false, error: 'nope' })
    render(<SelfRatingPanel />)
    const sw = await screen.findByRole('switch')
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(sw)
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))
  })
})
