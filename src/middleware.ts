import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

export default NextAuth(authConfig).auth((req) => {
  const isProtectedRoute =
    req.nextUrl.pathname.startsWith("/sets/new") ||
    req.nextUrl.pathname.includes("/edit") ||
    req.nextUrl.pathname.includes("/match") ||
    req.nextUrl.pathname.includes("/review") ||
    req.nextUrl.pathname.includes("/quiz") ||
    // `/settings` as a prefix rather than `/settings/ai` specifically, so
    // splitting that page again does not silently leave the new half
    // unprotected — which is exactly what happened when the scoring panels
    // moved to `/settings/study` on 2026-08-28.
    req.nextUrl.pathname.startsWith("/settings");

  if (isProtectedRoute && !req.auth) {
    const url = new URL("/login", req.nextUrl)
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search)
    return Response.redirect(url)
  }
})

export const config = {
  matcher: [
    '/sets/new',
    '/sets/:id*/edit',
    '/sets/:id*/match',
    '/sets/:id*/review',
    '/sets/:id*/quiz',
    // Every settings page, present and future. The predicate above tests the
    // same prefix; both halves must agree or the check never runs.
    '/settings/:path*',
  ],
}
