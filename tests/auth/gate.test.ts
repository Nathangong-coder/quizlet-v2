import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decide, isSignedIn, isProtectedPath } from '@/lib/auth/gate'

/**
 * The middleware gate must FAIL CLOSED. Auth.js hands the callback its error
 * object as `req.auth` when it cannot resolve a session (untrusted host,
 * missing secret) — truthy — and the gate used to test `!req.auth`. Every
 * protected route then answered an anonymous request. These pin the fix.
 */
const SESSION = { user: { id: 'u1' }, expires: 'x' }
const ERROR_AS_AUTH = { message: 'UntrustedHost: Host must be trusted.' }

describe('isSignedIn', () => {
  it('is true only for a session with a user', () => {
    expect(isSignedIn(SESSION)).toBe(true)
  })
  it('is FALSE for null, undefined, an empty object, a userless session, and an Auth.js error object', () => {
    for (const v of [null, undefined, {}, { user: null }, { user: undefined }, ERROR_AS_AUTH]) {
      expect(isSignedIn(v as never), JSON.stringify(v)).toBe(false)
    }
  })
})

describe('decide', () => {
  it('sends an anonymous caller on a protected route to sign-in with the callback', () => {
    expect(decide({ pathname: '/settings/ai', search: '?tab=1', auth: null })).toEqual({ type: 'redirect', path: '/login?callbackUrl=%2Fsettings%2Fai%3Ftab%3D1' })
    expect(decide({ pathname: '/sets/abc/edit', search: '', auth: null })).toEqual({ type: 'redirect', path: '/login?callbackUrl=%2Fsets%2Fabc%2Fedit' })
  })

  it('treats an Auth.js ERROR as anonymous — the fail-closed case', () => {
    expect(decide({ pathname: '/settings/ai', search: '', auth: ERROR_AS_AUTH })).toEqual({ type: 'redirect', path: '/login?callbackUrl=%2Fsettings%2Fai' })
    expect(decide({ pathname: '/', search: '', auth: ERROR_AS_AUTH })).toEqual({ type: 'rewrite', path: '/welcome' })
    expect(decide({ pathname: '/welcome', search: '', auth: ERROR_AS_AUTH })).toEqual({ type: 'next' })
  })

  it('lets a signed-in caller through and sends them home from /welcome', () => {
    expect(decide({ pathname: '/settings/ai', search: '', auth: SESSION })).toEqual({ type: 'next' })
    expect(decide({ pathname: '/', search: '', auth: SESSION })).toEqual({ type: 'next' })
    expect(decide({ pathname: '/welcome', search: '', auth: SESSION })).toEqual({ type: 'redirect', path: '/' })
  })

  it('rewrites a visitor’s / to the landing and leaves public routes alone', () => {
    expect(decide({ pathname: '/', search: '', auth: null })).toEqual({ type: 'rewrite', path: '/welcome' })
    expect(decide({ pathname: '/browse', search: '?q=x', auth: null })).toEqual({ type: 'next' })
  })

  it('protects every settings page, present and future', () => {
    for (const p of ['/settings', '/settings/ai', '/settings/study', '/settings/whatever/deep']) expect(isProtectedPath(p), p).toBe(true)
    for (const p of ['/', '/browse', '/sets/abc', '/u/alice', '/features/test']) expect(isProtectedPath(p), p).toBe(false)
  })
})

describe('the middleware source', () => {
  const src = readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf8')
  it('never tests req.auth directly — only through the gate', () => {
    expect(src).toMatch(/from ['"]@\/lib\/auth\/gate['"]/)
    expect(src).not.toMatch(/!req\.auth\b/)
    // Passing it INTO the gate is the only allowed use; testing it here is not.
    expect(src).not.toMatch(/req\.auth\s*(&&|\|\||\?[^.])/)
  })
  it('keeps the matcher and the protected-path rule in agreement', () => {
    for (const m of ['/sets/new', '/sets/:id*/edit', '/sets/:id*/review', '/sets/:id*/quiz', '/settings/:path*', "'/'", "'/welcome'"]) {
      expect(src, m).toContain(m)
    }
  })
})
