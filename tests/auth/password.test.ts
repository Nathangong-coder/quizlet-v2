import { describe, it, expect } from 'vitest'
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  checkPassword,
  hashPassword,
  verifyPassword,
  verifyAgainstDummy,
  DUMMY_PASSWORD_HASH,
} from '@/lib/auth/password'

describe('checkPassword', () => {
  it('accepts a password at exactly the minimum length', () => {
    expect(checkPassword('a'.repeat(PASSWORD_MIN_LENGTH))).toEqual({ ok: true })
  })

  it('rejects one character below the minimum', () => {
    // The boundary is asserted from BOTH sides so an off-by-one in the
    // comparison operator cannot pass.
    expect(checkPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toEqual({
      ok: false,
      reason: 'too_short',
    })
  })

  it('rejects a password longer than 72 BYTES, not 72 characters', () => {
    // bcrypt silently truncates past 72 bytes: two different long passwords
    // then hash identically, so accepting them would mean the extra
    // characters are security theatre. Emoji are 4 bytes each, so 20 of them
    // are 80 bytes in 20 characters.
    const emoji = '🔐'.repeat(20)
    expect(emoji.length).toBeLessThan(PASSWORD_MAX_BYTES)
    expect(Buffer.byteLength(emoji, 'utf8')).toBeGreaterThan(PASSWORD_MAX_BYTES)
    expect(checkPassword(emoji)).toEqual({ ok: false, reason: 'too_long' })
  })

  it('accepts a 72-byte password', () => {
    expect(checkPassword('a'.repeat(PASSWORD_MAX_BYTES))).toEqual({ ok: true })
  })

  it('does NOT trim — padding counts toward length, so a below-minimum core is still accepted', () => {
    // Handles are trimmed; passwords must not be. Trimming would silently
    // change what the user typed and make a stored password unenterable.
    //
    // The discriminating fixture: a 10-char core (2 below the minimum) with
    // 2 spaces of padding on each side, for a 14-char total. A correct,
    // non-trimming implementation measures the whole 14-char string against
    // the minimum and accepts it ({ ok: true }). An implementation that
    // trims first would measure only the 10-char core, see it fall below
    // the minimum, and reject it ({ ok: false, reason: 'too_short' }) —
    // that divergence is what makes this case able to fail.
    const padded = '  ' + 'a'.repeat(10) + '  '
    expect(checkPassword(padded)).toEqual({ ok: true })
  })

  it('does NOT trim — a padded password at the minimum core length is still accepted', () => {
    // Companion case: padding around an already-valid core should not be
    // rejected either. This alone can't prove trimming didn't happen (see
    // the case above for that), but it shows padding isn't penalized.
    const padded = '  ' + 'a'.repeat(PASSWORD_MIN_LENGTH) + '  '
    expect(checkPassword(padded)).toEqual({ ok: true })
  })
})

describe('hashPassword / verifyPassword', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
  }, 20_000)

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false)
  }, 20_000)

  it('never returns the password in the hash, and uses cost 12', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).not.toContain('correct')
    // The cost factor is the whole defence for a leaked database. A silent
    // drop to the library default (10) is 4x cheaper to crack and is
    // invisible to every other test here.
    expect(hash.slice(0, 7)).toMatch(/^\$2[aby]\$12\$/)
  }, 20_000)

  it('produces a different hash for the same password each time (salted)', async () => {
    const a = await hashPassword('correct horse battery staple')
    const b = await hashPassword('correct horse battery staple')
    expect(a).not.toBe(b)
  }, 30_000)

  it('returns false rather than throwing on a malformed hash', async () => {
    // A row with a corrupt or truncated hash must fail closed, not 500 the
    // login route.
    //
    // Two different corrupt shapes, both real: a too-short string that
    // bcryptjs short-circuits on length alone (never reaches a try/catch,
    // so this alone doesn't prove one exists), and a 60-character string
    // that passes the length check but is structurally invalid, which
    // bcryptjs actually throws on ("Invalid salt version") — only this
    // second case exercises the catch.
    expect(await verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false)
    expect(await verifyPassword('anything', 'x'.repeat(60))).toBe(false)
  })
})

describe('DUMMY_PASSWORD_HASH', () => {
  it('is a real cost-12 hash, so comparing against it costs what a real one costs', () => {
    // If this were a placeholder string, bcrypt would reject it instantly and
    // the timing-equalisation in verifyAgainstDummy would protect nothing.
    expect(DUMMY_PASSWORD_HASH.slice(0, 7)).toMatch(/^\$2[aby]\$12\$/)
    expect(DUMMY_PASSWORD_HASH.length).toBe(60)
  })

  it('verifyAgainstDummy is always false, whatever it is given', async () => {
    expect(await verifyAgainstDummy('')).toBe(false)
    expect(await verifyAgainstDummy('dummy-password-for-timing-equalisation')).toBe(false)
  }, 20_000)
})
