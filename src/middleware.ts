import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

export default NextAuth(authConfig).auth((req) => {
  const isProtectedRoute =
    req.nextUrl.pathname.startsWith("/sets/new") ||
    req.nextUrl.pathname.includes("/edit") ||
    req.nextUrl.pathname.includes("/match") ||
    req.nextUrl.pathname.includes("/review") ||
    req.nextUrl.pathname.includes("/quiz") ||
    req.nextUrl.pathname.startsWith("/settings/ai");

  if (isProtectedRoute && !req.auth) {
    const url = new URL("/login", req.nextUrl)
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search)
    return Response.redirect(url)
  }
})

export const config = {
  matcher: ['/sets/new', '/sets/:id*/edit', '/sets/:id*/match', '/sets/:id*/review', '/sets/:id*/quiz', '/settings/ai'],
}
