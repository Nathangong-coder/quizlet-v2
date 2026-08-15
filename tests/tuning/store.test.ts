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
  h.upsert.mockResolvedValue({
    strategy: 'balanced', bands: {}, thresholds: {}, studyScope: null,
  })
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

describe('saveTuning: the study scope is the FOURTH partial field', () => {
  it('writes only studyScope, naming none of the other three', async () => {
    await saveTuning({ studyScope: { setIds: ['set-a'], categoryKeys: ['accounting'] } })
    const [args] = h.upsert.mock.calls[0]
    expect(args.update).toEqual({
      studyScope: { setIds: ['set-a'], categoryKeys: ['accounting'] },
      version: 1,
    })
    expect(args.update).not.toHaveProperty('bands')
    expect(args.update).not.toHaveProperty('thresholds')
    expect(args.update).not.toHaveProperty('strategy')
  })

  it('leaves the scope alone when ANOTHER panel saves', async () => {
    // The discriminating case for the whole partial design, now at four fields.
    // A write-everything action would put `studyScope: {}` in this update and
    // silently un-scope a learner who only changed their strategy.
    await saveTuning({ strategy: 'follow_forgetting' })
    expect(h.upsert.mock.calls[0][0].update).not.toHaveProperty('studyScope')
  })

  it('treats an EMPTY scope as a real value — that is "study everything"', async () => {
    // Distinct from absent. Clearing the scope must be expressible, or the
    // learner can narrow but never widen again.
    await saveTuning({ studyScope: { setIds: [], categoryKeys: [] } })
    expect(h.upsert.mock.calls[0][0].update).toHaveProperty('studyScope', {
      setIds: [], categoryKeys: [],
    })
  })

  it('fills a missing dimension rather than rejecting the save', async () => {
    await saveTuning({ studyScope: { setIds: ['set-a'] } })
    expect(h.upsert.mock.calls[0][0].update.studyScope).toEqual({
      setIds: ['set-a'], categoryKeys: [],
    })
  })

  it('rejects a malformed scope and writes NOTHING', async () => {
    // A save is an explicit user act, so it fails loudly — unlike a corrupt
    // STORED blob, which degrades to "everything".
    const res = await saveTuning({ studyScope: { setIds: 'set-a' } })
    expect(res.success).toBe(false)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('rejects an unknown key rather than storing a setting nothing reads', async () => {
    const res = await saveTuning({ studyScope: { setIds: [], categoryKeys: [], cardIds: ['c'] } })
    expect(res.success).toBe(false)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('creates the row with an explicit empty scope when none exists yet', async () => {
    await saveTuning({ strategy: 'balanced' })
    expect(h.upsert.mock.calls[0][0].create.studyScope).toEqual({
      setIds: [], categoryKeys: [],
    })
  })
})

describe('getUserTuning returns the scope STORED, not resolved', () => {
  it('hands back exactly what is on the row', async () => {
    h.findUnique.mockResolvedValue({
      strategy: 'balanced',
      bands: null,
      thresholds: null,
      studyScope: { setIds: ['set-deleted'], categoryKeys: [] },
    })
    const out = await getUserTuning(USER)
    // Deliberately NOT resolved here: a dead set id survives this call and is
    // only judged by `resolveStudyScope`, where the learner's live sets are
    // already loaded. Resolving here would put two queries behind every
    // metrics computation, most of which are handed an explicit scope.
    expect(out.studyScope).toEqual({ setIds: ['set-deleted'], categoryKeys: [] })
  })

  it('degrades a corrupt scope to empty without touching bands or thresholds', async () => {
    h.findUnique.mockResolvedValue({
      strategy: 'polish_near_ready',
      bands: { inversion: [1, 2] },
      thresholds: { minObservations: 1 },
      studyScope: 'garbage',
    })
    const out = await getUserTuning(USER)
    expect(out.studyScope).toEqual({ setIds: [], categoryKeys: [] })
    expect(out.bands.inversion).toEqual([1, 2])
    expect(out.thresholds.minObservations).toBe(1)
    expect(out.strategy).toBe('polish_near_ready')
  })
})
