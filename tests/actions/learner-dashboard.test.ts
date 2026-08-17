import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Spec 3C §2 and §6.4. The three properties that decide whether the page tells
 * the truth about what it is showing:
 *  - a URL scope beats the saved default (a shared link must show what it says);
 *  - the saved default applies when the URL says nothing;
 *  - an all-stale saved scope WIDENS and sets the flag — asserting the flag,
 *    not just the widening, because a silent widening is the defect.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getLearnerMetrics: vi.fn(),
  loadCoverage: vi.fn(),
  tuningFindUnique: vi.fn(),
  setFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    learnerTuning: { findUnique: h.tuningFindUnique },
    set: { findMany: h.setFindMany },
    cardCategory: { findMany: h.categoryFindMany },
  },
}))
vi.mock('@/lib/metrics/read', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/metrics/read')>()),
  getLearnerMetrics: h.getLearnerMetrics,
  resolveScopeCategoryIds: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/metrics/coverage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/metrics/coverage')>()),
  loadCoverage: h.loadCoverage,
}))

import { getLearnerDashboard } from '@/actions/learner-dashboard'
import { EMPTY_SCOPE } from '@/lib/memory/scope'

const HEALTHY_COVERAGE = {
  klpStates: 20,
  klpStatesClearingFloor: 12,
  cardsWithLiveKlps: 30,
  cardsWithLiveKlpsInScope: 30,
  categorizedCards: 25,
  topicCapableCards: 25,
  pendingExtraction: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.tuningFindUnique.mockResolvedValue(null)
  h.setFindMany.mockResolvedValue([{ id: 'set-a' }])
  h.categoryFindMany.mockResolvedValue([{ normalizedName: 'accounting' }])
  h.loadCoverage.mockResolvedValue(HEALTHY_COVERAGE)
  h.getLearnerMetrics.mockResolvedValue({
    profile: { cards: {}, topics: [] },
    misconceptions: [],
    forgetting: null,
    paceOutliers: [],
    ranked: [],
  })
})

function storedScope(studyScope: unknown) {
  h.tuningFindUnique.mockResolvedValue({
    strategy: 'balanced', bands: null, thresholds: null, studyScope,
  })
}

describe('getLearnerDashboard: which scope wins', () => {
  it('refuses when signed out', async () => {
    h.auth.mockResolvedValue(null)
    expect(await getLearnerDashboard(null)).toEqual({ success: false, error: 'Not signed in' })
  })

  it('uses the saved scope when the URL says nothing', async () => {
    storedScope({ setIds: ['set-a'], categoryKeys: [] })
    const res = await getLearnerDashboard(null)

    expect(res.success && res.data.appliedScope.setIds).toEqual(['set-a'])
    expect(res.success && res.data.defaultApplied).toBe(true)
  })

  it('lets an EXPLICIT empty URL scope beat the saved default', async () => {
    // The "Show everything" case. A URL is a more specific instruction than a
    // setting, and this is the distinction `hasExplicitScope` exists to make —
    // it reaches here as an empty scope rather than as null.
    storedScope({ setIds: ['set-a'], categoryKeys: [] })
    const res = await getLearnerDashboard(EMPTY_SCOPE)

    expect(res.success && res.data.appliedScope.setIds).toEqual([])
    expect(res.success && res.data.defaultApplied).toBe(false)
  })

  it('uses a non-empty URL scope verbatim', async () => {
    storedScope({ setIds: ['set-a'], categoryKeys: [] })
    const res = await getLearnerDashboard({ ...EMPTY_SCOPE, setIds: ['set-z'] })
    expect(res.success && res.data.appliedScope.setIds).toEqual(['set-z'])
  })

  it('never resolves a URL scope for staleness', async () => {
    // A bookmarked or shared link must show what it says, including nothing.
    const res = await getLearnerDashboard({ ...EMPTY_SCOPE, setIds: ['set-deleted'] })
    expect(res.success && res.data.appliedScope.setIds).toEqual(['set-deleted'])
    expect(res.success && res.data.widened).toBe(false)
    expect(h.setFindMany).not.toHaveBeenCalled()
  })

  it('does not announce a default when the saved scope is empty', async () => {
    // Otherwise every new account gets a "showing your saved scope" banner for
    // a setting they never touched.
    storedScope({ setIds: [], categoryKeys: [] })
    const res = await getLearnerDashboard(null)
    expect(res.success && res.data.defaultApplied).toBe(false)
  })
})

describe('getLearnerDashboard: stale saved scopes', () => {
  it('WIDENS and sets the flag when nothing survives', async () => {
    storedScope({ setIds: ['set-deleted'], categoryKeys: ['merged-away'] })
    const res = await getLearnerDashboard(null)

    expect(res.success && res.data.appliedScope).toEqual({ setIds: [], categoryKeys: [], sources: [] })
    // The flag, not just the widening. Widening in silence is the defect.
    expect(res.success && res.data.widened).toBe(true)
    expect(res.success && res.data.staleSetIds).toEqual(['set-deleted'])
    expect(res.success && res.data.staleCategoryKeys).toEqual(['merged-away'])
    expect(res.success && res.data.defaultApplied).toBe(false)
  })

  it('keeps the survivors when only some references are dead', async () => {
    storedScope({ setIds: ['set-a', 'set-deleted'], categoryKeys: [] })
    const res = await getLearnerDashboard(null)

    expect(res.success && res.data.appliedScope.setIds).toEqual(['set-a'])
    expect(res.success && res.data.widened).toBe(false)
    expect(res.success && res.data.defaultApplied).toBe(true)
  })
})

describe('getLearnerDashboard: what it hands the page', () => {
  it("passes the learner's own floor through so copy never hardcodes 3", async () => {
    h.tuningFindUnique.mockResolvedValue({
      strategy: 'polish_near_ready',
      bands: null,
      thresholds: { minObservations: 1 },
      studyScope: null,
    })
    const res = await getLearnerDashboard(null)

    expect(res.success && res.data.thresholds.minObservations).toBe(1)
    expect(res.success && res.data.strategy).toBe('polish_near_ready')
    // And the SAME floor reaches the coverage query, or the two disagree about
    // what counts as measured.
    expect(h.loadCoverage.mock.calls[0][4]).toBe(1)
  })

  it('diagnoses scope_too_narrow only under a scope', async () => {
    storedScope({ setIds: ['set-a'], categoryKeys: [] })
    h.loadCoverage.mockResolvedValue({ ...HEALTHY_COVERAGE, cardsWithLiveKlpsInScope: 0 })
    const res = await getLearnerDashboard(null)
    expect(res.success && res.data.empty?.kind).toBe('scope_too_narrow')
  })

  it('does not diagnose scope_too_narrow when unscoped', async () => {
    h.loadCoverage.mockResolvedValue({ ...HEALTHY_COVERAGE, cardsWithLiveKlpsInScope: 0 })
    const res = await getLearnerDashboard(EMPTY_SCOPE)
    expect(res.success && res.data.empty?.kind).not.toBe('scope_too_narrow')
  })

  it('reads metrics and coverage under the SAME scope', async () => {
    // Two populations behind one page is how a dashboard starts contradicting
    // itself — a topic list from one scope beside counts from another.
    storedScope({ setIds: ['set-a'], categoryKeys: [] })
    await getLearnerDashboard(null)

    expect(h.getLearnerMetrics.mock.calls[0][0].scope.setIds).toEqual(['set-a'])
    expect(h.loadCoverage.mock.calls[0][2].setIds).toEqual(['set-a'])
  })

  it('degrades to an error result rather than throwing', async () => {
    h.getLearnerMetrics.mockRejectedValue(new Error('boom'))
    const res = await getLearnerDashboard(null)
    expect(res.success).toBe(false)
  })
})
