// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'

/**
 * Spec 3B §5: three panels edit one row, and `saveTuning` is partial so that
 * they cannot revert each other. That contract only holds if each panel
 * actually sends ONE field — an echoed value from a stale mount is exactly the
 * bug partial saves exist to prevent, and it is invisible to a test that
 * renders one panel and only checks it saved.
 *
 * The plan hands the cross-panel check to a human at /settings/ai. This covers
 * the same invariant at the payload level, since that gate needs a signed-in
 * browser session and may be a while coming.
 */

// RTL's auto-cleanup needs a global afterEach, which this repo doesn't
// register (vitest.config.ts has no `globals: true`).
afterEach(cleanup)

const h = vi.hoisted(() => ({ loadTuning: vi.fn(), saveTuning: vi.fn() }))

// 'use server' module: importing it for real drags next-auth into jsdom and
// the file dies at load with "Cannot find module next/server".
vi.mock('@/actions/learner-tuning', () => ({
  loadTuning: h.loadTuning,
  saveTuning: h.saveTuning,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import SeverityBandPanel from '@/components/settings/SeverityBandPanel'
import TargetingStrategyPanel from '@/components/settings/TargetingStrategyPanel'
import MetricThresholdPanel from '@/components/settings/MetricThresholdPanel'
import { DEFAULT_BANDS } from '@/lib/errors/bands'
import { DEFAULT_THRESHOLDS } from '@/lib/tuning/schema'

const STORED = {
  strategy: 'polish_near_ready' as const,
  bandOverrides: { inversion: [1, 2] as [number, number] },
  thresholdOverrides: { minObservations: 1 },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.loadTuning.mockResolvedValue({ success: true, data: STORED })
  h.saveTuning.mockResolvedValue({ success: true, data: STORED })
})

const lastSavePayload = () => h.saveTuning.mock.calls[0][0]

describe('SeverityBandPanel', () => {
  it('sends ONLY bandOverrides, never the strategy or thresholds it loaded', async () => {
    render(<SeverityBandPanel />)
    await waitFor(() => screen.getByText('Save bands'))

    fireEvent.click(screen.getByText('Save bands'))
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())

    const payload = lastSavePayload()
    expect(payload).toHaveProperty('bandOverrides')
    expect(payload).not.toHaveProperty('strategy')
    expect(payload).not.toHaveProperty('thresholdOverrides')
  })

  it('keeps the stored blob sparse — untouched types are not sent', async () => {
    // An untouched type must keep tracking future default changes rather than
    // being frozen at today's value.
    render(<SeverityBandPanel />)
    await waitFor(() => screen.getByText('Save bands'))

    fireEvent.click(screen.getByText('Save bands'))
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())

    expect(Object.keys(lastSavePayload().bandOverrides)).toEqual(['inversion'])
  })

  it('rejects an inverted band without saving anything', async () => {
    render(<SeverityBandPanel />)
    await waitFor(() => screen.getByText('Save bands'))

    fireEvent.change(screen.getByLabelText('Inversion mildest'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Inversion most severe'), { target: { value: '2' } })
    fireEvent.click(screen.getByText('Save bands'))

    await waitFor(() => expect(h.saveTuning).not.toHaveBeenCalled())
  })

  it('rejects an out-of-range band rather than clamping it', async () => {
    render(<SeverityBandPanel />)
    await waitFor(() => screen.getByText('Save bands'))

    fireEvent.change(screen.getByLabelText('Inversion most severe'), { target: { value: '9' } })
    fireEvent.click(screen.getByText('Save bands'))

    await waitFor(() => expect(h.saveTuning).not.toHaveBeenCalled())
  })

  it('shows the shipped default beside the edited value', async () => {
    render(<SeverityBandPanel />)
    await waitFor(() => screen.getByText('Save bands'))
    const [floor, ceiling] = DEFAULT_BANDS.inversion
    expect(screen.getAllByText(`default ${floor}–${ceiling}`).length).toBeGreaterThan(0)
  })

  it('warns, at the point of edit, that a pinned ceiling also rescores MC and TF', async () => {
    render(<SeverityBandPanel />)
    await waitFor(() => screen.getByText('Save bands'))
    // Five accuracy types carry pinned ceilings; the warning belongs on each.
    expect(screen.getAllByText(/Also affects multiple choice and true\/false/)).toHaveLength(5)
  })

  it('warns that editing a band re-scores history', async () => {
    render(<SeverityBandPanel />)
    await waitFor(() => screen.getByText('Save bands'))
    expect(screen.getByText(/re-scores your history/)).toBeTruthy()
  })
})

describe('TargetingStrategyPanel', () => {
  it('sends ONLY the strategy', async () => {
    render(<TargetingStrategyPanel />)
    await waitFor(() => screen.getByText('Balanced (default)'))

    fireEvent.click(screen.getByText('Balanced (default)'))
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())

    const payload = lastSavePayload()
    expect(payload).toEqual({ strategy: 'balanced' })
  })

  it('says plainly that the ranking is not displayed yet', async () => {
    // A setting that appears to do nothing is worse than one labelled as
    // forthcoming — `getLearnerMetrics` has no production caller until 3C.
    render(<TargetingStrategyPanel />)
    await waitFor(() => screen.getByText(/Not yet visible anywhere/))
    expect(screen.getByText(/ordering only/)).toBeTruthy()
  })

  it('marks the stored strategy as selected', async () => {
    render(<TargetingStrategyPanel />)
    await waitFor(() => screen.getByText("Polish what's nearly ready"))
    const selected = screen.getByText("Polish what's nearly ready").closest('button')
    expect(selected?.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('MetricThresholdPanel', () => {
  it('sends ONLY thresholdOverrides', async () => {
    render(<MetricThresholdPanel />)
    await waitFor(() => screen.getByText('Save thresholds'))

    fireEvent.click(screen.getByText('Save thresholds'))
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())

    const payload = lastSavePayload()
    expect(payload).toHaveProperty('thresholdOverrides')
    expect(payload).not.toHaveProperty('strategy')
    expect(payload).not.toHaveProperty('bandOverrides')
  })

  it('rejects an evidence floor of zero rather than clamping it', async () => {
    render(<MetricThresholdPanel />)
    await waitFor(() => screen.getByText('Save thresholds'))

    fireEvent.change(screen.getByLabelText('Evidence before an opinion'), { target: { value: '0' } })
    fireEvent.click(screen.getByText('Save thresholds'))

    await waitFor(() => expect(h.saveTuning).not.toHaveBeenCalled())
  })

  it('rejects a readiness weight of zero — readiness divides by it', async () => {
    render(<MetricThresholdPanel />)
    await waitFor(() => screen.getByText('Save thresholds'))

    fireEvent.change(screen.getByLabelText('Readiness strictness'), { target: { value: '0' } })
    fireEvent.click(screen.getByText('Save thresholds'))

    await waitFor(() => expect(h.saveTuning).not.toHaveBeenCalled())
  })

  it('keeps overrides sparse and shows the shipped defaults', async () => {
    render(<MetricThresholdPanel />)
    await waitFor(() => screen.getByText('Save thresholds'))

    fireEvent.click(screen.getByText('Save thresholds'))
    await waitFor(() => expect(h.saveTuning).toHaveBeenCalled())

    expect(Object.keys(lastSavePayload().thresholdOverrides)).toEqual(['minObservations'])
    expect(screen.getByText(`default ${DEFAULT_THRESHOLDS.readinessWeightPerAnswer}`)).toBeTruthy()
  })

  it('frames the evidence floor as a bar for acting, not a "show more data" toggle', async () => {
    render(<MetricThresholdPanel />)
    await waitFor(() => screen.getByText(/lowers the bar for acting on what exists/))
    expect(screen.getByText(/guess with a number attached/)).toBeTruthy()
  })
})
