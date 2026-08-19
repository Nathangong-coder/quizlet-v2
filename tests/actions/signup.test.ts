import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn(), hashPassword: vi.fn() }))

vi.mock('@/lib/db', () => ({ prisma: { user: { create: h.create } } }))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, hashPassword: h.hashPassword }
})

import { signUp } from '@/actions/auth-signup'

const VALID = { handle: 'alice_ng', email: 'alice@example.com', password: 'a'.repeat(12) }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CREDENTIALS_SIGNUP_ENABLED = 'true'
  h.hashPassword.mockResolvedValue('$2b$12$hashed')
  h.create.mockResolvedValue({ id: 'u1' })
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
  })

  it('never runs a pre-flight uniqueness SELECT', async () => {
    // A check-then-write is a TOCTOU bug; the constraint is what decides.
    // `prisma.user` is mocked with `create` alone, so any findFirst/findUnique
    // call would throw rather than pass silently.
    await expect(signUp(VALID)).resolves.toMatchObject({ success: true })
  })
})
