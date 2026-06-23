import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

export default NextAuth(authConfig).auth((req) => {
  const isProtectedRoute =
    req.nextUrl.pathname.startsWith("/sets/new") ||
    req.nextUrl.pathname.includes("/edit") ||
    req.nextUrl.pathname.includes("/match");

  if (isProtectedRoute && !req.auth) {
    return Response.redirect(new URL("/api/auth/signin", req.nextUrl))
  }
})

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
