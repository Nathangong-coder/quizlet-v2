/**
 * The middleware's decision, as a pure function — so the one thing that must
 * never regress is a unit test, not a curl against a production build.
 *
 * EDGE-SAFE: no Prisma, no hashing, no `@/auth`. `tests/auth/edge-safety.test.ts`
 * walks the middleware's import graph and would fail if that changed.
 *
 * THE RULE: signed-in means `auth.user` exists. Never `Boolean(auth)`. When
 * Auth.js fails inside the middleware — untrusted host, missing secret — it
 * hands the callback its ERROR as `req.auth`: an object, truthy. A gate that
 * tests the object rather than the user reads every anonymous request as
 * signed in and fails OPEN. Found 2026-09-13 with `next start` and no
 * `AUTH_TRUST_HOST`: every protected route answered 200 to curl.
 */

/** What the middleware knows about the caller. Shaped like Auth.js's `req.auth`, loosely on purpose. */
export type GateAuth = { user?: { id?: string | null } | null } | { message?: string } | null | undefined

export function isSignedIn(auth: GateAuth): boolean {
  if (!auth || typeof auth !== 'object') return false
  if (!('user' in auth)) return false
  const user = (auth as { user?: unknown }).user
  return typeof user === 'object' && user !== null
}

export type GateDecision =
  | { type: 'next' }
  | { type: 'rewrite'; path: string }
  | { type: 'redirect'; path: string }

/** Paths a visitor must sign in to reach. Prefix / substring rules, mirrored by the matcher in src/middleware.ts. */
export function isProtectedPath(pathname: string): boolean {
  return (
    pathname.startsWith('/sets/new') ||
    pathname.includes('/edit') ||
    pathname.includes('/review') ||
    pathname.includes('/quiz') ||
    // `/settings` as a prefix rather than `/settings/ai` specifically, so
    // splitting that page again does not silently leave the new half
    // unprotected — which is exactly what happened when the scoring panels
    // moved to `/settings/study` on 2026-08-28.
    pathname.startsWith('/settings')
  )
}

export function decide(input: { pathname: string; search: string; auth: GateAuth }): GateDecision {
  const signedIn = isSignedIn(input.auth)

  // The landing: a visitor's `/` is served by the marketing group's page with
  // the address bar unchanged; a signed-in learner's `/` is home, and one who
  // lands on /welcome directly is sent home.
  if (input.pathname === '/' && !signedIn) return { type: 'rewrite', path: '/welcome' }
  if (input.pathname === '/welcome' && signedIn) return { type: 'redirect', path: '/' }

  if (isProtectedPath(input.pathname) && !signedIn) {
    const callback = encodeURIComponent(input.pathname + input.search)
    return { type: 'redirect', path: `/login?callbackUrl=${callback}` }
  }
  return { type: 'next' }
}
