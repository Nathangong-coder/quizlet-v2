import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  invalidateTokens: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: h.findUnique },
    // The update now happens on the transaction client, alongside the token
    // invalidation — `prisma.user` deliberately exposes no `update`, so a
    // version that writes outside the transaction throws.
    $transaction: (fn: (tx: unknown) => unknown) => fn({ user: { update: h.update } }),
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, hashPassword: h.hashPassword, verifyPassword: h.verifyPassword }
})
vi.mock('@/lib/auth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/tokens')>()
  return { ...actual, invalidateTokens: h.invalidateTokens }
})

import { savePassword } from '@/actions/password'

const NEW = 'n'.repeat(12)

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.hashPassword.mockResolvedValue('$2b$12$new')
  h.update.mockResolvedValue({})
  h.invalidateTokens.mockResolvedValue(undefined)
  h.findUnique.mockResolvedValue({ passwordHash: null, sessionVersion: 2, emailVerified: null })
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
    // Hashes the NEW password, not `current` (which is undefined here) — a
    // mutant that hashes `input.current` instead would hash `undefined` and
    // this pins the actual argument, not just that hashPassword ran.
    expect(h.hashPassword).toHaveBeenCalledWith(NEW)
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
    // Verifies the SUPPLIED current password against the STORED hash — not
    // against some other hash. A mutant that checks `input.current` against
    // `DUMMY_PASSWORD_HASH` (or any hash but the caller's own) would mean
    // nobody could ever change a password, yet none of the tests above would
    // notice since they only assert the boolean outcome.
    expect(h.verifyPassword).toHaveBeenCalledWith('o'.repeat(12), '$2b$12$old')
    // And hashes the NEW password (not `current`) for the write.
    expect(h.hashPassword).toHaveBeenCalledWith(NEW)
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

describe('savePassword also closes the reset hole', () => {
  it('invalidates outstanding password_reset tokens', async () => {
    // Otherwise: an attacker requests a reset, the owner notices and changes
    // their password from /account, and the attacker's emailed link stays live
    // for the rest of the hour.
    // (The default fixture is an OAuth-only account, so no current password is
    // required — the invalidation must happen on that branch too.)
    await savePassword({ next: 'a'.repeat(12) })
    expect(h.invalidateTokens).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'password_reset',
    })
  })

  it('sets emailVerified when it is null', async () => {
    // A GitHub account created after the gate shipped has emailVerified: null.
    // Without this, setting a password on /account locks the user out of
    // password sign-in immediately — while they are demonstrably signed in and
    // in control, with no self-registered address to have typo'd.
    h.findUnique.mockResolvedValue({ passwordHash: null, sessionVersion: 0, emailVerified: null })
    await savePassword({ next: 'a'.repeat(12) })
    expect(h.update.mock.calls[0][0].data.emailVerified).toBeInstanceOf(Date)
  })

  it('does NOT move an emailVerified that already exists', async () => {
    const original = new Date('2026-01-01T00:00:00.000Z')
    h.findUnique.mockResolvedValue({
      passwordHash: '$2b$12$old',
      sessionVersion: 3,
      emailVerified: original,
    })
    // Explicit, not inherited: this test supplies `current` against a
    // passwordHash, so it must pass the current-password check itself rather
    // than relying on a mockResolvedValue(true) left behind by an earlier
    // test — vi.clearAllMocks() clears call history but not implementations,
    // so an order-dependent pass here would be silent until the file (or a
    // `.only`) ran in a different order.
    h.verifyPassword.mockResolvedValue(true)
    await savePassword({ current: 'old-password', next: 'a'.repeat(12) })
    expect(h.update.mock.calls[0][0].data.emailVerified).toBeUndefined()
  })

  it('still bumps sessionVersion', async () => {
    h.findUnique.mockResolvedValue({
      passwordHash: '$2b$12$old',
      sessionVersion: 7,
      emailVerified: new Date(),
    })
    h.verifyPassword.mockResolvedValue(true)
    await savePassword({ current: 'old-password', next: 'a'.repeat(12) })
    expect(h.update.mock.calls[0][0].data.sessionVersion).toBe(8)
  })

  it('still requires a correct current password, and writes NOTHING without one', async () => {
    // Regression guard: the additions above must not weaken the check that is
    // the whole defence against an unattended open session.
    h.findUnique.mockResolvedValue({
      passwordHash: '$2b$12$old',
      sessionVersion: 3,
      emailVerified: null,
    })
    h.verifyPassword.mockResolvedValue(false)
    const res = await savePassword({ current: 'wrong', next: 'a'.repeat(12) })
    expect(res.success).toBe(false)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.invalidateTokens).not.toHaveBeenCalled()
  })
})
