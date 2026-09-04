// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  notFound: vi.fn(),
  overview: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    h.notFound()
    throw new Error('NEXT_NOT_FOUND')
  },
  usePathname: () => '/staff',
}))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/staff/queries', () => ({ loadStaffOverview: h.overview }))

import StaffPage from '@/app/(app)/staff/page'

beforeEach(() => {
  vi.clearAllMocks()
  h.overview.mockResolvedValue({
    liveKlps: 12,
    supersededKlps: 3,
    cardsByKlpStatus: { pending: 166, ready: 125, failed: 0, skipped: 0 },
    learnersWithEvidence: 2,
    sets: 4,
  })
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
