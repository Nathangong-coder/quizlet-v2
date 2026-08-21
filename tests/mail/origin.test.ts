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
    //
    // `appOrigin.length` (Function.prototype.length) is NOT a real guard here
    // — it stops counting at the first defaulted parameter, so it reports 0
    // whether or not a second, non-defaulted, request-derived parameter gets
    // added later. A compile-time check is what actually catches that:
    // @ts-expect-error — appOrigin accepts only an env bag; a second argument
    // (e.g. a Request/Host-bearing object) must fail to typecheck. If a
    // future refactor added such a parameter, this call would start
    // compiling and the directive above would itself become a build error
    // ("unused '@ts-expect-error' directive"), which is what makes this test
    // load-bearing instead of decorative.
    appOrigin({}, { headers: { host: 'evil.com' } })
  })

  it('flags a misspelled env key at the call site instead of silently reading undefined', () => {
    // The narrow `Env` type (not `NodeJS.ProcessEnv`) is what makes this
    // possible — it names the two keys appOrigin actually reads, so a typo
    // in either one is an excess property, not a silent no-op.
    // @ts-expect-error — 'NEXTAUTH_URLX' is not a key of Env.
    appOrigin({ NEXTAUTH_URLX: 'https://study.example.com' })
  })
})
