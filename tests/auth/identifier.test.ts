import { describe, it, expect } from 'vitest'
import { identifierWhere } from '@/lib/auth/identifier'

describe('identifierWhere', () => {
  it('matches an email case-insensitively by lowercasing it', () => {
    // Email is stored as the provider gave it; a user typing Alice@X.com must
    // still sign in. Lowercasing the needle is the cheap half of that.
    expect(identifierWhere('Alice@Example.com')).toEqual({
      OR: [{ email: 'alice@example.com' }, { normalizedHandle: 'alice@example.com' }],
    })
  })

  it('matches a handle through normalizedHandle, not handle', () => {
    // `handle` is the display form. Querying it would make `Alice_NG` and
    // `alice_ng` different logins for one account.
    const where = identifierWhere('Alice_NG')
    expect(where.OR).toContainEqual({ normalizedHandle: 'alice_ng' })
    expect(JSON.stringify(where)).not.toContain('"handle"')
  })

  it('trims surrounding whitespace', () => {
    expect(identifierWhere('  alice  ')).toEqual({
      OR: [{ email: 'alice' }, { normalizedHandle: 'alice' }],
    })
  })

  it('never produces an empty OR branch, which would match every row', () => {
    // A `where` of `{}` or `{ OR: [] }` behaves as "any user" in Prisma for
    // findFirst — an empty identifier must not become a login as somebody.
    const where = identifierWhere('')
    expect(where.OR).toEqual([{ email: '' }, { normalizedHandle: '' }])
  })
})
