import { describe, expect, it } from 'vitest'
import { clientIp, hashIp, newGuestId, signGuestId, utcDayStart, verifyGuestCookie } from '@/lib/demo/identity'

describe('guest cookie', () => {
  const id = newGuestId()
  it('round-trips', () => {
    expect(verifyGuestCookie(signGuestId(id, 's'), 's')).toBe(id)
  })
  it('rejects tampering', () => {
    const v = signGuestId(id, 's')
    // Flip the last character deterministically (a fixed suffix can equal the real one).
    const last = v.slice(-1)
    expect(verifyGuestCookie(v.slice(0, -1) + (last === 'A' ? 'B' : 'A'), 's')).toBeNull()
    expect(verifyGuestCookie(signGuestId(id, 's').replace(id, newGuestId()), 's')).toBeNull()
    expect(verifyGuestCookie(id, 's')).toBeNull()
    expect(verifyGuestCookie(v, 'other')).toBeNull()
    expect(verifyGuestCookie(undefined, 's')).toBeNull()
  })
})

describe('ip', () => {
  it('takes the first forwarded entry', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' }))).toBe('1.2.3.4')
    expect(clientIp(new Headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9')
    expect(clientIp(new Headers())).toBe('unknown')
  })
  it('hashes deterministically per secret', () => {
    expect(hashIp('1.1.1.1', 'a')).toBe(hashIp('1.1.1.1', 'a'))
    expect(hashIp('1.1.1.1', 'a')).not.toBe(hashIp('1.1.1.1', 'b'))
  })
})

describe('utcDayStart', () => {
  it('floors to UTC midnight', () => {
    expect(utcDayStart(new Date('2026-11-17T23:59:00-08:00')).toISOString()).toBe('2026-11-18T00:00:00.000Z')
  })
})
