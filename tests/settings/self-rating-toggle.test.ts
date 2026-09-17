import { describe, it, expect, vi, beforeEach } from 'vitest'

// Spec 6 §4: `captureSelfRating` is the FIFTH partial field on LearnerTuning.
// Default ON; a user with no row loads `true` (the schema default, not a
// fabricated row); saving it names none of the other four fields.
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
import { shapeTuning } from '@/lib/tuning/schema'

const USER = 'u1'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: USER } })
  h.findUnique.mockResolvedValue(null)
  h.upsert.mockResolvedValue({
    strategy: 'balanced', bands: {}, thresholds: {}, studyScope: null, captureSelfRating: false,
  })
})

describe('captureSelfRating loads', () => {
  it('loadTuning with no row returns captureSelfRating: true', async () => {
    const res = await loadTuning()
    expect(res.success && res.data.captureSelfRating).toBe(true)
  })

  it('loadTuning returns the stored false', async () => {
    h.findUnique.mockResolvedValue({
      strategy: 'balanced', bands: null, thresholds: null, studyScope: null, captureSelfRating: false,
    })
    const res = await loadTuning()
    expect(res.success && res.data.captureSelfRating).toBe(false)
  })

  it('getUserTuning with no row resolves captureSelfRating: true, and reads the column', async () => {
    const out = await getUserTuning(USER)
    expect(out.captureSelfRating).toBe(true)
    expect(h.findUnique.mock.calls[0][0].select).toHaveProperty('captureSelfRating', true)
    h.findUnique.mockResolvedValue({ strategy: 'balanced', bands: null, thresholds: null, studyScope: null, captureSelfRating: false })
    expect((await getUserTuning(USER)).captureSelfRating).toBe(false)
  })

  it('shapeTuning defaults a row without the field to true (pure)', () => {
    expect(shapeTuning(null).captureSelfRating).toBe(true)
    expect(shapeTuning({ strategy: 'balanced', bands: null, thresholds: null, studyScope: null }).captureSelfRating).toBe(true)
    expect(shapeTuning({ strategy: 'balanced', bands: null, thresholds: null, studyScope: null, captureSelfRating: false }).captureSelfRating).toBe(false)
  })
})

describe('captureSelfRating saves', () => {
  it('saveTuning({ captureSelfRating: false }) writes only that field', async () => {
    const res = await saveTuning({ captureSelfRating: false })
    expect(res.success).toBe(true)
    const [args] = h.upsert.mock.calls[0]
    expect(args.update).toEqual({ captureSelfRating: false, version: 1 })
    expect(args.create).toHaveProperty('captureSelfRating', false)
    expect(args.select).toHaveProperty('captureSelfRating', true)
  })

  it('returns the saved value from the row', async () => {
    const res = await saveTuning({ captureSelfRating: false })
    expect(res.success && res.data.captureSelfRating).toBe(false)
  })

  it('an absent field leaves the toggle untouched, and a create defaults it on', async () => {
    await saveTuning({ strategy: 'balanced' })
    const [args] = h.upsert.mock.calls[0]
    expect(args.update).not.toHaveProperty('captureSelfRating')
    expect(args.create).toHaveProperty('captureSelfRating', true)
  })

  it('rejects a non-boolean and writes NOTHING', async () => {
    const res = await saveTuning({ captureSelfRating: 'yes' as unknown as boolean })
    expect(res.success).toBe(false)
    expect(h.upsert).not.toHaveBeenCalled()
  })
})
