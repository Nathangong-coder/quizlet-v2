import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  create: vi.fn(),
  hashPassword: vi.fn(),
  inviteFindUnique: vi.fn(),
  inviteUpdateMany: vi.fn(),
  inviteFindFirst: vi.fn(),
  // Tracked (not a plain arrow function) so a test can assert order relative
  // to $transaction ITSELF being called — comparing hashPassword only against
  // inviteUpdateMany cannot tell "outside the transaction" from "first line
  // inside the callback", since both precede updateMany either way.
  transaction: vi.fn(),
  mintToken: vi.fn(),
  sendVerificationEmail: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}))

// after() runs its callback out of band in production. The tests need to be
// able to await it, so the mock records the promise instead of dropping it.
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    h.afterTasks.push(Promise.resolve().then(fn))
  },
}))

// `prisma.user` deliberately exposes NO create: the only legitimate create is
// on the transaction client, so a version that writes outside the transaction
// throws rather than passing silently.
vi.mock('@/lib/db', () => ({
  prisma: {
    inviteCode: { findUnique: h.inviteFindUnique },
    user: {},
    $transaction: h.transaction,
  },
}))
// Set once, outside beforeEach: vi.clearAllMocks() clears .mock.calls but
// preserves a mockImplementation, so this survives every test.
h.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
  fn({
    inviteCode: { updateMany: h.inviteUpdateMany, findFirst: h.inviteFindFirst },
    user: { create: h.create },
  }),
)
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, hashPassword: h.hashPassword }
})
vi.mock('@/lib/auth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/tokens')>()
  return { ...actual, mintToken: h.mintToken }
})
vi.mock('@/lib/mail/send', () => ({ sendVerificationEmail: h.sendVerificationEmail }))

import { signUp } from '@/actions/auth-signup'

const VALID = {
  handle: 'alice_ng',
  email: 'alice@example.com',
  password: 'a'.repeat(12),
  inviteCode: 'ABCDE-FG234',
}

async function drainAfter() {
  const tasks = h.afterTasks.splice(0)
  await Promise.all(tasks)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.afterTasks.length = 0
  process.env.CREDENTIALS_SIGNUP_ENABLED = 'true'
  h.hashPassword.mockResolvedValue('$2b$12$hashed')
  h.create.mockResolvedValue({ id: 'u1' })
  h.inviteFindUnique.mockResolvedValue({ usesRemaining: 3, revokedAt: null, expiresAt: null })
  h.inviteUpdateMany.mockResolvedValue({ count: 1 })
  h.inviteFindFirst.mockResolvedValue({ id: 'inv1' })
  h.mintToken.mockResolvedValue('raw-token')
  h.sendVerificationEmail.mockResolvedValue(undefined)
})

afterEach(() => {
  delete process.env.CREDENTIALS_SIGNUP_ENABLED
})

describe('the flag', () => {
  it('refuses when sign-up is closed, without touching the database', async () => {
    // The page guard is not enough on its own: a server action is a public
    // endpoint and can be called without ever loading the page.
    delete process.env.CREDENTIALS_SIGNUP_ENABLED
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('treats any value other than "true" as closed', async () => {
    for (const value of ['false', '1', 'yes', '']) {
      process.env.CREDENTIALS_SIGNUP_ENABLED = value
      h.create.mockClear()
      const res = await signUp(VALID)
      expect(res.success, value).toBe(false)
      expect(h.create).not.toHaveBeenCalled()
    }
  })
})

describe('signUp', () => {
  it('creates the user with BOTH handle forms, a hash, and a set-at stamp', async () => {
    const res = await signUp(VALID)
    expect(res.success).toBe(true)

    const data = h.create.mock.calls[0][0].data
    expect(data.handle).toBe('alice_ng')
    expect(data.normalizedHandle).toBe('alice_ng')
    expect(data.email).toBe('alice@example.com')
    expect(data.passwordHash).toBe('$2b$12$hashed')
    expect(data.passwordSetAt).toBeInstanceOf(Date)
  })

  it('lowercases the email it stores', async () => {
    // Sign-in lowercases the needle (identifierWhere). Storing a mixed-case
    // address would make the account unreachable by its own email.
    await signUp({ ...VALID, email: 'Alice@Example.COM' })
    expect(h.create.mock.calls[0][0].data.email).toBe('alice@example.com')
  })

  it('NEVER stores the raw password', async () => {
    await signUp(VALID)
    expect(JSON.stringify(h.create.mock.calls[0][0].data)).not.toContain(VALID.password)
  })

  it('rejects a bad handle before hashing anything', async () => {
    const res = await signUp({ ...VALID, handle: 'ab' })
    expect(res.success).toBe(false)
    expect(h.hashPassword).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('rejects a reserved handle', async () => {
    const res = await signUp({ ...VALID, handle: 'admin' })
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/reserved/i)
  })

  it('rejects a short password', async () => {
    const res = await signUp({ ...VALID, password: 'short' })
    expect(res.success).toBe(false)
    expect(h.hashPassword).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('rejects a malformed email', async () => {
    for (const bad of ['alice', 'alice@', '@example.com', 'a b@c.co']) {
      const res = await signUp({ ...VALID, email: bad })
      expect(res.success, bad).toBe(false)
    }
    expect(h.create).not.toHaveBeenCalled()
  })

  it('turns a P2002 collision into a message that does NOT say which field collided', async () => {
    // Saying "that email is taken" confirms an address has an account to
    // anyone who can type one in. The handle half is not secret, but a single
    // message is the only version that cannot leak the email half.
    h.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).not.toMatch(/email/i)
    expect(res.error).not.toMatch(/handle/i)
  })

  it('never runs a pre-flight uniqueness SELECT', async () => {
    // A check-then-write is a TOCTOU bug; the constraint is what decides.
    // `prisma.user` is mocked with no methods at all, so any findFirst,
    // findUnique, or out-of-transaction create would throw rather than pass
    // silently.
    await expect(signUp(VALID)).resolves.toMatchObject({ success: true })
  })

  it('hashes BEFORE opening the transaction, so bcrypt is not held across a connection', async () => {
    // Holding a Postgres transaction open across ~250ms of bcrypt is how a
    // serverless app exhausts its connection pool under any concurrency.
    // Compared against $transaction's OWN call order, not inviteUpdateMany's:
    // hashPassword moved to the first line INSIDE the callback would still
    // precede inviteUpdateMany, so that comparison alone cannot see the move.
    //
    // NOTE ON WHAT THIS CANNOT CATCH: invocationCallOrder records when
    // hashPassword was CALLED, not when it was awaited. Holding the promise
    // (`const p = hashPassword(...)`) and awaiting it inside the transaction
    // passes this assertion while genuinely holding bcrypt across the open
    // transaction. Catching that needs a resolution-time flag, which was
    // deliberately not built: the mutant reads as obviously intentional in
    // review, and the microtask machinery is a maintenance hazard a future
    // "simplification" would silently re-break.
    await signUp(VALID)
    expect(h.hashPassword.mock.invocationCallOrder[0]).toBeLessThan(
      h.transaction.mock.invocationCallOrder[0],
    )
  })
})

describe('invite redemption', () => {
  it('records which code let the account in, and creates it UNVERIFIED', async () => {
    const res = await signUp(VALID)
    expect(res.success).toBe(true)
    const data = h.create.mock.calls[0][0].data
    expect(data.invitedByCodeId).toBe('inv1')
    expect(data.emailVerified).toBeNull()
  })

  it('refuses a dead code BEFORE spending a bcrypt round', async () => {
    // /signup would otherwise be a CPU amplifier anyone can fire with random
    // codes: ~250ms of hashing per request, before any account exists.
    h.inviteFindUnique.mockResolvedValue({ usesRemaining: 0, revokedAt: null, expiresAt: null })
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/invite code/i)
    expect(h.hashPassword).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses an unknown code', async () => {
    h.inviteFindUnique.mockResolvedValue(null)
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses when the last slot is taken between the pre-check and the decrement', async () => {
    // The pre-check passes, the atomic update claims nothing. This is the race
    // the counter exists for, and the pre-check cannot see it.
    h.inviteUpdateMany.mockResolvedValue({ count: 0 })
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    if (res.success) return
    expect(res.error).toMatch(/invite code/i)
  })

  it('decrements and creates on the SAME transaction client', async () => {
    // `prisma.user` has no `create` in the mock, so a create outside the
    // transaction throws. That is the structural guarantee that a P2002
    // rollback also restores the invite use — a typo must not burn a code.
    await signUp(VALID)
    expect(h.inviteUpdateMany).toHaveBeenCalledTimes(1)
    expect(h.create).toHaveBeenCalledTimes(1)
  })

  it('restores the invite use on a duplicate account, via the rollback', async () => {
    h.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    const res = await signUp(VALID)
    expect(res.success).toBe(false)
    if (res.success) return
    // Neither field named, exactly as before.
    expect(res.error).not.toMatch(/email/i)
    expect(res.error).not.toMatch(/handle/i)
    // And no compensating write: the transaction is what restores it.
    expect(h.inviteUpdateMany).toHaveBeenCalledTimes(1)
    expect(h.inviteUpdateMany.mock.calls[0][0].data).toEqual({ usesRemaining: { decrement: 1 } })
  })
})

describe('verification mail', () => {
  it('mints an email_verify token and sends it, in after()', async () => {
    await signUp(VALID)
    // Nothing sent yet — the response was already returned.
    expect(h.sendVerificationEmail).not.toHaveBeenCalled()
    await drainAfter()
    expect(h.mintToken).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'email_verify',
    })
    expect(h.sendVerificationEmail).toHaveBeenCalledWith('alice@example.com', 'raw-token')
  })

  it('sends nothing when the account was not created', async () => {
    h.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    await signUp(VALID)
    await drainAfter()
    expect(h.sendVerificationEmail).not.toHaveBeenCalled()
  })
})
