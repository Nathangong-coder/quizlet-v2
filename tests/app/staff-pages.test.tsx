// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  notFound: vi.fn(),
  overview: vi.fn(),
  klps: vi.fn(),
  setFindMany: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    h.notFound()
    throw new Error('NEXT_NOT_FOUND')
  },
  usePathname: () => '/staff',
}))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/staff/queries', () => ({ loadStaffOverview: h.overview, loadStaffKlps: h.klps }))
vi.mock('@/lib/db', () => ({ prisma: { set: { findMany: h.setFindMany } } }))

import StaffPage from '@/app/(app)/staff/page'
import StaffKlpsPage from '@/app/(app)/staff/klps/page'

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
  })

  it('404s for a signed-out visitor', async () => {
    h.auth.mockResolvedValue(null)
    await expect(
      StaffKlpsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
