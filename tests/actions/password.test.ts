import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: { user: { findUnique: h.findUnique, update: h.update } },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, hashPassword: h.hashPassword, verifyPassword: h.verifyPassword }
})

import { savePassword } from '@/actions/password'

const NEW = 'n'.repeat(12)

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.hashPassword.mockResolvedValue('$2b$12$new')
  h.update.mockResolvedValue({})
  h.findUnique.mockResolvedValue({ passwordHash: null, sessionVersion: 2 })
})

describe('savePassword', () => {
  it('refuses a signed-out caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await savePassword({ next: NEW })
    expect(res).toEqual({ success: false, error: 'Unauthorized' })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('sets a first password for an OAuth-only account without asking for a current one', async () => {
    const res = await savePassword({ next: NEW })
    expect(res.success).toBe(true)
    expect(h.verifyPassword).not.toHaveBeenCalled()
    expect(h.update.mock.calls[0][0].data.passwordHash).toBe('$2b$12$new')
  })

  it('requires the CURRENT password when one is already set', async () => {
    // Without this, anyone with a borrowed open session takes the account
    // permanently — there is no reset to recover it with.
    h.findUnique.mockResolvedValue({ passwordHash: '$2b$12$old', sessionVersion: 2 })
    const res = await savePassword({ next: NEW })
    expect(res.success).toBe(false)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('rejects a wrong current password', async () => {
    h.findUnique.mockResolvedValue({ passwordHash: '$2b$12$old', sessionVersion: 2 })
    h.verifyPassword.mockResolvedValue(false)
    const res = await savePassword({ current: 'wrongwrongwrong', next: NEW })
    expect(res.success).toBe(false)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('BUMPS sessionVersion, so a password change signs other sessions out', async () => {
    // The whole reason the column exists. A JWT cannot be deleted; changing
    // the password without bumping this leaves a stolen token working.
    h.findUnique.mockResolvedValue({ passwordHash: '$2b$12$old', sessionVersion: 2 })
    h.verifyPassword.mockResolvedValue(true)

    await savePassword({ current: 'o'.repeat(12), next: NEW })

    expect(h.update.mock.calls[0][0].data.sessionVersion).toBe(3)
  })

  it('bumps on a FIRST password too', async () => {
    // Setting a password is also a security-state change, and any token issued
    // before it should not outlive it.
    await savePassword({ next: NEW })
    expect(h.update.mock.calls[0][0].data.sessionVersion).toBe(3)
  })

  it('stamps passwordSetAt', async () => {
    await savePassword({ next: NEW })
    expect(h.update.mock.calls[0][0].data.passwordSetAt).toBeInstanceOf(Date)
  })

  it('enforces the length policy on the new password', async () => {
    const res = await savePassword({ next: 'short' })
    expect(res.success).toBe(false)
    expect(h.hashPassword).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('scopes every read and write to the caller, never to an id from the argument', async () => {
    await savePassword({ next: NEW })
    expect(h.findUnique.mock.calls[0][0].where).toEqual({ id: 'u1' })
    expect(h.update.mock.calls[0][0].where).toEqual({ id: 'u1' })
  })
})
