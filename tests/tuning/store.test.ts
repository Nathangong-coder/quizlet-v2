import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_BANDS } from '@/lib/errors/bands'
import { DEFAULT_THRESHOLDS } from '@/lib/tuning/schema'

// Follows the vi.hoisted() + vi.mock('@/lib/db') pattern established by
// tests/actions/quiz-summary-analysis.test.ts.
const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  auth: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  prisma: { learnerTuning: { findUnique: h.findUnique, upsert: h.upsert } },
}))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getUserTuning } from '@/lib/tuning/store'
import { saveTuning, loadTuning } from '@/actions/learner-tuning'

const USER = 'u1'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: USER } })
  h.findUnique.mockResolvedValue(null)
  h.upsert.mockResolvedValue({ strategy: 'balanced', bands: {}, thresholds: {} })
})

describe('getUserTuning', () => {
  it('returns fully-resolved defaults for a user with no row', async () => {
    h.findUnique.mockResolvedValue(null)
    const out = await getUserTuning('u1')
    expect(out.strategy).toBe('balanced')
    expect(out.bands).toEqual(DEFAULT_BANDS)
    expect(out.thresholds).toEqual(DEFAULT_THRESHOLDS)
  })

  it('merges a sparse override into a COMPLETE band table', async () => {
    h.findUnique.mockResolvedValue({
      strategy: 'polish_near_ready', bands: { inversion: [1, 2] }, thresholds: { minObservations: 1 },
    })
    const out = await getUserTuning('u1')
    expect(out.bands.inversion).toEqual([1, 2])
    expect(out.bands.conflation).toEqual(DEFAULT_BANDS.conflation)
    // The guarantee callers depend on: never a partial table, because
    // resolveSeverity replaces rather than merges.
    expect(Object.keys(out.bands).sort()).toEqual(Object.keys(DEFAULT_BANDS).sort())
    expect(out.thresholds.minObservations).toBe(1)
    expect(out.thresholds.readinessWeightPerAnswer).toBe(DEFAULT_THRESHOLDS.readinessWeightPerAnswer)
    expect(out.strategy).toBe('polish_near_ready')
  })

  it('scopes the read to the requested user', async () => {
    h.findUnique.mockResolvedValue(null)
    await getUserTuning('u7')
    expect(h.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u7' } }),
    )
  })

  it('falls back to full defaults on a corrupt stored blob rather than throwing', async () => {
    h.findUnique.mockResolvedValue({ strategy: 'balanced', bands: 'garbage', thresholds: 'garbage' })
    const out = await getUserTuning('u1')
    expect(out.bands).toEqual(DEFAULT_BANDS)
    expect(out.thresholds).toEqual(DEFAULT_THRESHOLDS)
  })
})

describe('loadTuning', () => {
  it('refuses when signed out', async () => {
    h.auth.mockResolvedValue(null)
    expect(await loadTuning()).toEqual({ success: false, error: 'Not signed in' })
  })

  it('returns SPARSE overrides, not the resolved table — the panel shows what was edited', async () => {
    h.findUnique.mockResolvedValue({
      strategy: 'balanced', bands: { inversion: [1, 2] }, thresholds: null,
    })
    const res = await loadTuning()
    expect(res.success && Object.keys(res.data.bandOverrides)).toEqual(['inversion'])
  })
})

describe('saveTuning is PARTIAL (spec §5)', () => {
  it('writes only the field it was given, leaving the others untouched', async () => {
    // Three panels edit one row. A write-all-three action forces each panel to
    // echo values it read at mount, so "change a threshold, change a band, save
    // both" reverts one of them. Absent field => absent from the update.
    await saveTuning({ strategy: 'follow_forgetting' })
    const [args] = h.upsert.mock.calls[0]
    expect(args.update).toEqual({ strategy: 'follow_forgetting', version: 1 })
    expect(args.update).not.toHaveProperty('bands')
    expect(args.update).not.toHaveProperty('thresholds')
  })

  it('treats an EMPTY band map as a real value — that is the global reset', async () => {
    await saveTuning({ bandOverrides: {} })
    expect(h.upsert.mock.calls[0][0].update).toHaveProperty('bands', {})
  })

  it('scopes the upsert to the signed-in user', async () => {
    await saveTuning({ strategy: 'balanced' })
    expect(h.upsert.mock.calls[0][0].where).toEqual({ userId: USER })
  })

  it('rejects an invalid band and writes NOTHING', async () => {
    const res = await saveTuning({ bandOverrides: { inversion: [4, 2] } })
    expect(res.success).toBe(false)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range threshold and writes NOTHING', async () => {
    const res = await saveTuning({ thresholdOverrides: { minObservations: 0 } })
    expect(res.success).toBe(false)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('rejects an unknown error type rather than storing a band nothing will read', async () => {
    const res = await saveTuning({ bandOverrides: { not_a_type: [1, 2] } })
    expect(res.success).toBe(false)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('returns the WHOLE row after saving, not just what was sent', async () => {
    // The caller has to see the fields it did not send, or a panel that saves
    // one field renders the other two as empty.
    h.upsert.mockResolvedValue({
      strategy: 'polish_near_ready',
      bands: { inversion: [1, 2] },
      thresholds: { minObservations: 1 },
      studyScope: { setIds: ['set-a'], categoryKeys: [] },
    })
    const res = await saveTuning({ strategy: 'polish_near_ready' })
    expect(res.success && res.data).toEqual({
      strategy: 'polish_near_ready',
      bandOverrides: { inversion: [1, 2] },
      thresholdOverrides: { minObservations: 1 },
      studyScope: { setIds: ['set-a'], categoryKeys: [] },
    })
  })

  it('refuses when signed out', async () => {
    h.auth.mockResolvedValue(null)
    expect(await saveTuning({ strategy: 'balanced' })).toEqual({
      success: false, error: 'Not signed in',
    })
    expect(h.upsert).not.toHaveBeenCalled()
  })
})
