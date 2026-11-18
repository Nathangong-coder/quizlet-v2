// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ invite: vi.fn() }))
vi.mock('@/actions/waitlist', () => ({ inviteFromWaitlist: h.invite }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

import { WaitlistTable, type WaitlistTableRow } from '@/components/staff/WaitlistTable'

afterEach(cleanup)

const row: WaitlistTableRow = {
  id: 'r1', email: 'ann@example.com', note: null,
  requestedAt: '2026-11-01', lastRequestedAt: '2026-11-01', invitedAt: null, inviteCode: null,
}

describe('WaitlistTable', () => {
  it('keeps the minted code and its Copy button after the refreshed rows drop the invited row', async () => {
    h.invite.mockResolvedValue({ success: true, data: { code: 'ABCDE-FGHJK', emailed: false } })
    const { rerender } = render(<WaitlistTable rows={[row]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(screen.getByText('ABCDE-FGHJK')).toBeTruthy())

    // Pending tab after revalidate: the invited row is gone.
    rerender(<WaitlistTable rows={[]} />)
    expect(screen.getByText('ABCDE-FGHJK')).toBeTruthy()
    expect(screen.getByText('ann@example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
  })
})
