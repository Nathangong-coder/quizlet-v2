import { describe, it, expect } from 'vitest'
import { appOrigin } from '@/lib/mail/origin'

describe('appOrigin', () => {
  it('prefers NEXTAUTH_URL', () => {
    expect(appOrigin({ NEXTAUTH_URL: 'https://study.example.com' })).toBe('https://study.example.com')
  })

  it('strips a trailing slash so links do not double up', () => {
    expect(appOrigin({ NEXTAUTH_URL: 'https://study.example.com/' })).toBe('https://study.example.com')
  })

  it('falls back to https://$VERCEL_URL', () => {
    expect(appOrigin({ VERCEL_URL: 'quizlet-v2.vercel.app' })).toBe('https://quizlet-v2.vercel.app')
  })

  it('falls back to localhost last', () => {
    expect(appOrigin({})).toBe('http://localhost:3000')
  })

  it('ignores an empty NEXTAUTH_URL rather than emitting a link to nowhere', () => {
    expect(appOrigin({ NEXTAUTH_URL: '   ', VERCEL_URL: 'x.vercel.app' })).toBe('https://x.vercel.app')
  })

  it('takes NOTHING from a caller-supplied host', () => {
    // Building an absolute URL from the Host header is the classic poisoned
    // reset link: an attacker sets `Host: evil.com` and the server mails YOUR
    // user a link to their own valid token, on the attacker's domain.
    // appOrigin's only argument is an env bag; there is no request in scope.
    expect(appOrigin.length).toBeLessThanOrEqual(1)
  })
})
