import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: { user: { update: h.userUpdate, findUnique: h.userFindUnique } },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  getAccountSettings,
  saveHandle,
  saveContactEmail,
  saveEmailUpdates,
} from '@/actions/account'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.userUpdate.mockResolvedValue({})
})

describe('every account action refuses a signed-out caller', () => {
  it('refuses across the board', async () => {
    h.auth.mockResolvedValue(null)
    for (const call of [
      () => getAccountSettings(),
      () => saveHandle('alice'),
      () => saveContactEmail('a@b.co'),
      () => saveEmailUpdates(true),
    ]) {
      const res = await call()
      expect(res).toEqual({ success: false, error: 'Unauthorized' })
    }
    expect(h.userUpdate).not.toHaveBeenCalled()
  })
})

describe('saveHandle', () => {
  it('writes BOTH the display and normalized forms', async () => {
    // Writing `handle` alone leaves the uniqueness key null for that row, so
    // the constraint silently stops applying to them.
    const res = await saveHandle('Alice_NG')
    expect(res.success).toBe(true)
    expect(h.userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { handle: 'Alice_NG', normalizedHandle: 'alice_ng' },
    })
  })

  it('scopes the write to the CALLER, never to an id from the argument', async () => {
    await saveHandle('alice')
    expect(h.userUpdate.mock.calls[0][0].where).toEqual({ id: 'u1' })
  })

  it('rejects an invalid handle without touching the database', async () => {
    const res = await saveHandle('a')
    expect(res.success).toBe(false)
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('rejects a reserved handle without touching the database', async () => {
    const res = await saveHandle('admin')
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/reserved/i)
    expect(h.userUpdate).not.toHaveBeenCalled()
  })

  it('turns a unique-constraint violation into "already taken"', async () => {
    // Reached in ordinary use, not just under a race — two people simply want
    // the same name. A pre-flight SELECT would be a TOCTOU bug, so the
    // constraint is what decides and this is where that answer arrives.
    h.userUpdate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    const res = await saveHandle('alice')
    expect(res).toEqual({ success: false, error: 'That handle is already taken.' })
  })

  it('does not report an unrelated database error as "already taken"', async () => {
    h.userUpdate.mockRejectedValue(Object.assign(new Error('down'), { code: 'P1001' }))
    const res = await saveHandle('alice')
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).not.toMatch(/already taken/i)
  })
})

describe('saveContactEmail', () => {
  it('saves a well-formed address', async () => {
    const res = await saveContactEmail('alice@example.com')
    expect(res.success).toBe(true)
    expect(h.userUpdate.mock.calls[0][0].data).toEqual({ contactEmail: 'alice@example.com' })
  })

  it('stores NULL for an empty value, so the field can be unset', async () => {
    // A setting you can set but not clear is a trap; the column is nullable
    // precisely so "none" is representable.
    const res = await saveContactEmail('   ')
    expect(res.success).toBe(true)
    expect(h.userUpdate.mock.calls[0][0].data).toEqual({ contactEmail: null })
  })

  it('rejects a malformed address without touching the database', async () => {
    for (const bad of ['alice', 'alice@', '@example.com', 'alice@example', 'a b@c.co']) {
      h.userUpdate.mockClear()
      const res = await saveContactEmail(bad)
      expect(res.success, bad).toBe(false)
      expect(h.userUpdate).not.toHaveBeenCalled()
    }
  })

  it('never writes the ACCOUNT email column', async () => {
    // `email` is identity and the future recovery address. This action must not
    // be a back door into changing it.
    await saveContactEmail('alice@example.com')
    expect(h.userUpdate.mock.calls[0][0].data).not.toHaveProperty('email')
  })
})

describe('saveEmailUpdates', () => {
  it('records both opting in and opting out', async () => {
    await saveEmailUpdates(true)
    expect(h.userUpdate.mock.calls[0][0].data).toEqual({ emailUpdates: true })

    h.userUpdate.mockClear()
    await saveEmailUpdates(false)
    expect(h.userUpdate.mock.calls[0][0].data).toEqual({ emailUpdates: false })
  })

  it('writes only its own field, so it cannot revert another panel', async () => {
    // The structural version of the /settings/ai partial-save contract: one
    // action per field means a clobber is unrepresentable rather than merely
    // tested for.
    await saveEmailUpdates(true)
    expect(Object.keys(h.userUpdate.mock.calls[0][0].data)).toEqual(['emailUpdates'])
  })
})

describe('getAccountSettings', () => {
  it('returns the account fields for the caller', async () => {
    h.userFindUnique.mockResolvedValue({
      handle: 'alice',
      email: 'alice@github.example',
      contactEmail: null,
      emailUpdates: false,
    })
    const res = await getAccountSettings()
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.data.handle).toBe('alice')
    expect(h.userFindUnique.mock.calls[0][0].where).toEqual({ id: 'u1' })
  })

  it('reports a missing row rather than returning a half-empty account', async () => {
    h.userFindUnique.mockResolvedValue(null)
    const res = await getAccountSettings()
    expect(res.success).toBe(false)
  })
})
