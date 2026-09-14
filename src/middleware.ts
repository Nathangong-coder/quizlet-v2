import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"
import { NextResponse } from "next/server"

export default NextAuth(authConfig).auth((req) => {
  // `req.auth?.user`, NEVER `req.auth`. When Auth.js itself fails — an
  // untrusted host, a missing secret — it hands the callback its ERROR as
  // `req.auth`, an object, which is truthy. A bare `!req.auth` then reads
  // every anonymous request as signed in and this gate fails OPEN. Found
  // 2026-09-13 running `next start` locally without AUTH_TRUST_HOST: every
  // protected route answered 200 to curl. Pages check the session themselves,
  // so nothing was exposed, but the middleware must not depend on that.
  const signedIn = Boolean(req.auth?.user)

  // The landing. A visitor's `/` is REWRITTEN (address bar unchanged) to the
  // marketing group's page so the landing never ships the app shell's
  // client bundle; a signed-in learner's `/` is their home, and one who
  // lands on /welcome directly is sent home. See src/app/(marketing)/layout.tsx.
  if (req.nextUrl.pathname === "/" && !signedIn) {
    return NextResponse.rewrite(new URL("/welcome", req.nextUrl))
  }
  if (req.nextUrl.pathname === "/welcome" && signedIn) {
    return NextResponse.redirect(new URL("/", req.nextUrl))
  }

  const isProtectedRoute =
    req.nextUrl.pathname.startsWith("/sets/new") ||
    req.nextUrl.pathname.includes("/edit") ||
    req.nextUrl.pathname.includes("/review") ||
    req.nextUrl.pathname.includes("/quiz") ||
    // `/settings` as a prefix rather than `/settings/ai` specifically, so
    // splitting that page again does not silently leave the new half
    // unprotected — which is exactly what happened when the scoring panels
    // moved to `/settings/study` on 2026-08-28.
    req.nextUrl.pathname.startsWith("/settings");

  if (isProtectedRoute && !signedIn) {
    const url = new URL("/login", req.nextUrl)
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search)
    return NextResponse.redirect(url)
  }
})

export const config = {
  matcher: [
    '/',
    '/welcome',
    '/sets/new',
    '/sets/:id*/edit',
    '/sets/:id*/review',
    '/sets/:id*/quiz',
    // Every settings page, present and future. The predicate above tests the
    // same prefix; both halves must agree or the check never runs.
    '/settings/:path*',
  ],
}
