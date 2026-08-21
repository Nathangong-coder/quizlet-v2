import { describe, it, expect } from 'vitest'
import {
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  generateInviteCode,
  normalizeInviteCode,
  formatInviteCode,
} from '@/lib/invites/code'

describe('the alphabet', () => {
  it('is Crockford Base32 — 32 symbols with no I, L, O or U', () => {
    expect(INVITE_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ')
    expect(INVITE_ALPHABET).toHaveLength(32)
    for (const banned of ['I', 'L', 'O', 'U']) {
      expect(INVITE_ALPHABET).not.toContain(banned)
    }
  })
})

describe('generateInviteCode', () => {
  it('is 10 symbols from the alphabet — 50 bits', () => {
    const code = generateInviteCode()
    expect(code).toHaveLength(INVITE_CODE_LENGTH)
    for (const ch of code) expect(INVITE_ALPHABET).toContain(ch)
  })

  it('does not repeat across many draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateInviteCode()))
    expect(seen.size).toBe(500)
  })

  it('produces codes that survive their own normalisation', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode()
      expect(normalizeInviteCode(code)).toBe(code)
    }
  })
})

describe('normalizeInviteCode', () => {
  it('uppercases', () => {
    expect(normalizeInviteCode('abcdef2345')).toBe('ABCDEF2345')
  })

  it('strips hyphens and spaces — the display form round-trips', () => {
    expect(normalizeInviteCode('ABCDE-FG234')).toBe('ABCDEFG234')
    expect(normalizeInviteCode('  ABCDE FG234  ')).toBe('ABCDEFG234')
  })

  it('maps every ambiguous character the way Crockford says', () => {
    // Read aloud or written down, these are the four that get confused.
    expect(normalizeInviteCode('I')).toBe('1')
    expect(normalizeInviteCode('l')).toBe('1')
    expect(normalizeInviteCode('L')).toBe('1')
    expect(normalizeInviteCode('O')).toBe('0')
    expect(normalizeInviteCode('o')).toBe('0')
  })

  it('handles a realistic mis-transcription end to end', () => {
    // Someone reads "0J1K..." aloud and the listener writes O, J, l, K.
    expect(normalizeInviteCode('oj1k-2m3n4p')).toBe(normalizeInviteCode('0J1K2M3N4P'))
  })

  it('drops anything outside the alphabet rather than passing it to a query', () => {
    // "TABLE" contains an L, which the alphabet doesn't have — it survives
    // only via the I/L -> 1 substitution, so it comes out as "TAB1E".
    expect(normalizeInviteCode("ABCDE'; DROP TABLE--FG234")).toBe('ABCDEDR0PTAB1EFG234')
  })

  it('is idempotent', () => {
    const once = normalizeInviteCode('abc-de f2 34')
    expect(normalizeInviteCode(once)).toBe(once)
  })
})

describe('formatInviteCode', () => {
  it('groups a 10-symbol code as XXXXX-XXXXX', () => {
    expect(formatInviteCode('ABCDEFG234')).toBe('ABCDE-FG234')
  })

  it('round-trips through normalisation', () => {
    const code = generateInviteCode()
    expect(normalizeInviteCode(formatInviteCode(code))).toBe(code)
  })
})
