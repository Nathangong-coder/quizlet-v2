import { describe, it, expect } from 'vitest'
import {
  checkHandle,
  normalizeHandle,
  RESERVED_HANDLES,
  HANDLE_MIN_LENGTH,
  HANDLE_MAX_LENGTH,
} from '@/lib/users/handle'

describe('normalizeHandle', () => {
  it('lowercases, so two casings cannot both be claimed', () => {
    expect(normalizeHandle('Alice')).toBe('alice')
    expect(normalizeHandle('ALICE')).toBe('alice')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeHandle('  alice  ')).toBe('alice')
  })
})

describe('checkHandle accepts', () => {
  it('a plain handle, returning BOTH forms', () => {
    // Both, together, so a caller cannot persist the display form and leave
    // the uniqueness key null for that row.
    expect(checkHandle('Alice_NG')).toEqual({
      ok: true,
      handle: 'Alice_NG',
      normalized: 'alice_ng',
    })
  })

  it('digits and underscores', () => {
    expect(checkHandle('a_1_b').ok).toBe(true)
  })

  it('trims before validating, so a padded entry is not rejected', () => {
    const result = checkHandle('  alice  ')
    expect(result).toEqual({ ok: true, handle: 'alice', normalized: 'alice' })
  })

  it('exactly the minimum and maximum lengths', () => {
    expect(checkHandle('a'.repeat(HANDLE_MIN_LENGTH)).ok).toBe(true)
    expect(checkHandle('a'.repeat(HANDLE_MAX_LENGTH)).ok).toBe(true)
  })
})

describe('checkHandle rejects', () => {
  it('an empty or whitespace-only handle', () => {
    expect(checkHandle('')).toEqual({ ok: false, reason: 'empty' })
    expect(checkHandle('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('one character under the minimum', () => {
    expect(checkHandle('a'.repeat(HANDLE_MIN_LENGTH - 1))).toEqual({
      ok: false,
      reason: 'too_short',
    })
  })

  it('one character over the maximum', () => {
    expect(checkHandle('a'.repeat(HANDLE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'too_long',
    })
  })

  it('characters that would be ambiguous or unsafe in a URL', () => {
    for (const bad of ['alice ng', 'alice.ng', 'alice-ng', 'alice/ng', 'alice@ng', 'ali<ce']) {
      expect(checkHandle(bad).ok, bad).toBe(false)
    }
  })

  it('reports length before characters', () => {
    // "a!" is both too short AND badly formed. Reporting characters would send
    // the user to fix the wrong thing, then fail again on length.
    expect(checkHandle('a!')).toEqual({ ok: false, reason: 'too_short' })
  })

  it('every reserved name', () => {
    for (const reserved of RESERVED_HANDLES) {
      expect(checkHandle(reserved), reserved).toEqual({ ok: false, reason: 'reserved' })
    }
  })

  it('a reserved name in ANY casing', () => {
    // The list is compared against the normalized form. A case-sensitive check
    // would let `Admin` and `ADMIN` straight through.
    expect(checkHandle('Admin')).toEqual({ ok: false, reason: 'reserved' })
    expect(checkHandle('SETTINGS')).toEqual({ ok: false, reason: 'reserved' })
  })
})

describe('the reserved list covers the routes that exist', () => {
  it('reserves every current top-level route', () => {
    // If handles ever become /{handle}, a user named `settings` shadows a real
    // page. Reserving costs nothing now; reclaiming later takes a name off
    // someone who is using it.
    for (const route of ['sets', 'profile', 'settings', 'account', 'api', 'auth']) {
      expect(RESERVED_HANDLES).toContain(route)
    }
  })

  it('reserves the routes the roadmap names but has not built', () => {
    for (const route of ['browse', 'login', 'signup', 'learning']) {
      expect(RESERVED_HANDLES).toContain(route)
    }
  })

  it('is stored lowercased, or the casing test above is vacuous', () => {
    for (const reserved of RESERVED_HANDLES) {
      expect(reserved).toBe(reserved.toLowerCase())
    }
  })

  it('contains no entry that some OTHER rule already rejects', () => {
    // A reservation shorter than the minimum length, or containing an illegal
    // character, can never fire — the earlier check returns first. It reads as
    // protection while providing none. `me` was exactly that and was removed.
    //
    // This is what makes the "every reserved name" test above meaningful: it
    // asserts each entry is rejected AS reserved, which is only a real claim if
    // each entry would otherwise have been accepted.
    for (const reserved of RESERVED_HANDLES) {
      expect(reserved.length, reserved).toBeGreaterThanOrEqual(HANDLE_MIN_LENGTH)
      expect(reserved.length, reserved).toBeLessThanOrEqual(HANDLE_MAX_LENGTH)
      expect(/^[a-z0-9_]+$/.test(reserved), reserved).toBe(true)
    }
  })
})
