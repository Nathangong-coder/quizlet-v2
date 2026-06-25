import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

export default NextAuth(authConfig).auth((req) => {
  const isProtectedRoute =
    req.nextUrl.pathname.startsWith("/sets/new") ||
    req.nextUrl.pathname.includes("/edit") ||
    req.nextUrl.pathname.includes("/match") ||
    req.nextUrl.pathname.includes("/review");

  if (isProtectedRoute && !req.auth) {
    return Response.redirect(new URL("/api/auth/signin", req.nextUrl))
  }
})

export const config = {
  matcher: ['/sets/new', '/sets/:id*/edit', '/sets/:id*/match', '/sets/:id*/review'],
}
