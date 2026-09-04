// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  notFound: vi.fn(),
  overview: vi.fn(),
  klps: vi.fn(),
  coverage: vi.fn(),
  setFindMany: vi.fn(),
  learnerIndex: vi.fn(),
  learnerRecord: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    h.notFound()
    throw new Error('NEXT_NOT_FOUND')
  },
  usePathname: () => '/staff',
}))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/staff/queries', () => ({
  loadStaffOverview: h.overview,
  loadStaffKlps: h.klps,
  loadStaffCoverage: h.coverage,
  loadLearnerIndex: h.learnerIndex,
  loadLearnerRecord: h.learnerRecord,
}))
vi.mock('@/lib/db', () => ({ prisma: { set: { findMany: h.setFindMany } } }))

import StaffPage from '@/app/(app)/staff/page'
import StaffKlpsPage from '@/app/(app)/staff/klps/page'
import StaffCoveragePage from '@/app/(app)/staff/coverage/page'
import StaffLearnerPage from '@/app/(app)/staff/learners/[id]/page'

beforeEach(() => {
  vi.clearAllMocks()
  h.overview.mockResolvedValue({
    liveKlps: 12,
    supersededKlps: 3,
    cardsByKlpStatus: { pending: 166, ready: 125, failed: 0, skipped: 0 },
    learnersWithEvidence: 2,
    sets: 4,
  })
  h.klps.mockResolvedValue([])
  h.setFindMany.mockResolvedValue([])
})
afterEach(cleanup)

describe('/staff', () => {
  it('404s for a signed-out visitor, and never reads any data', async () => {
    h.auth.mockResolvedValue(null)
    await expect(StaffPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.overview).not.toHaveBeenCalled()
  })

  it('404s for a learner', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'learner' } })
    await expect(StaffPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.overview).not.toHaveBeenCalled()
  })

  it('renders the engine counts for staff', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    render(await StaffPage())
    expect(h.notFound).not.toHaveBeenCalled()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('166')).toBeInTheDocument()
  })

  it('renders for an admin too', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'admin' } })
    render(await StaffPage())
    expect(h.notFound).not.toHaveBeenCalled()
  })
})

describe('/staff/klps', () => {
  it('404s for a learner and reads no key points', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'learner' } })
    await expect(
      StaffKlpsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.klps).not.toHaveBeenCalled()
    // The page also reads prisma.set.findMany() for the set picker — the gate
    // must sit before THAT read too, not just before loadStaffKlps.
    expect(h.setFindMany).not.toHaveBeenCalled()
  })

  it('404s for a signed-out visitor', async () => {
    h.auth.mockResolvedValue(null)
    await expect(
      StaffKlpsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.setFindMany).not.toHaveBeenCalled()
  })
})

describe('/staff/coverage', () => {
  beforeEach(() => {
    h.coverage.mockResolvedValue([
      {
        setId: 's1',
        setTitle: 'Accounting - Knowledge',
        ownerLabel: 'nathan',
        total: 50,
        byKlpStatus: { pending: 50, ready: 0, failed: 0, skipped: 0 },
        byKltStatus: { pending: 50, ready: 0, failed: 0, skipped: 0 },
        failures: [],
      },
    ])
  })

  it('404s for a learner and reads no coverage', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'learner' } })
    await expect(StaffCoveragePage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.coverage).not.toHaveBeenCalled()
  })

  it('shows the extraction gap that demand-driven extraction left invisible', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    render(await StaffCoveragePage())
    expect(screen.getByText('Accounting - Knowledge')).toBeInTheDocument()
    // Both the key-points and topics columns read 0/50 for this fixture (both
    // passes are equally un-run), so this is a genuine double match rather
    // than an ambiguous query.
    expect(screen.getAllByText('0/50').length).toBe(2)
  })

  it('reports klpStatus and kltStatus separately — the two passes fail independently', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    render(await StaffCoveragePage())
    expect(screen.getByRole('columnheader', { name: /key points/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /topics/i })).toBeInTheDocument()
  })
})

describe('/staff/learners/[id]', () => {
  beforeEach(() => {
    h.learnerRecord.mockResolvedValue({
      label: 'nathan',
      weakest: [{ klpId: 'k1', text: 'EBIT falls by the full depreciation', pKnown: 0.18, observations: 4 }],
      recentAnswers: [],
      analysisStatusCounts: { analyzed: 12, no_klps: 3 },
    })
  })

  it('404s for a learner reading another learner', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u9', role: 'learner' } })
    await expect(
      StaffLearnerPage({ params: Promise.resolve({ id: 'u1' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.learnerRecord).not.toHaveBeenCalled()
  })

  it('404s for an unknown learner rather than rendering an empty record', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u9', role: 'staff' } })
    h.learnerRecord.mockResolvedValue(null)
    await expect(
      StaffLearnerPage({ params: Promise.resolve({ id: 'nope' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('shows the weakest key points and the analysis-status denominator', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u9', role: 'staff' } })
    render(await StaffLearnerPage({ params: Promise.resolve({ id: 'u1' }) }))
    expect(screen.getByText('EBIT falls by the full depreciation')).toBeInTheDocument()
    // analysisStatus matters: a relational tag table cannot distinguish
    // "analyzed and clean" from "could not analyze" — both are zero rows.
    expect(screen.getByText(/no_klps/)).toBeInTheDocument()
  })
})
