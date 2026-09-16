import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"
import { NextResponse } from "next/server"
import { decide } from "@/lib/auth/gate"

/**
 * The whole decision lives in `src/lib/auth/gate.ts` (pure, tested); this
 * file only turns it into a response. In particular, signed-in is decided
 * by `isSignedIn(req.auth)` — `req.auth?.user`, never `req.auth`, because
 * Auth.js hands the callback its ERROR object as `req.auth` when it fails,
 * and an object is truthy. See the gate module.
 */
export default NextAuth(authConfig).auth((req) => {
  const d = decide({ pathname: req.nextUrl.pathname, search: req.nextUrl.search, auth: req.auth })
  if (d.type === 'rewrite') return NextResponse.rewrite(new URL(d.path, req.nextUrl))
  if (d.type === 'redirect') return NextResponse.redirect(new URL(d.path, req.nextUrl))
})

export const config = {
  matcher: [
    '/',
    '/welcome',
    '/sets/new',
    '/sets/:id*/edit',
    '/sets/:id*/review',
    '/sets/:id*/quiz',
    // Every settings page, present and future. `isProtectedPath` tests the
    // same prefix; both halves must agree or the check never runs.
    '/settings/:path*',
  ],
}
