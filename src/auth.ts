import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db"
import { authConfig } from "@/auth.config"
import { authorizeCredentials } from "@/lib/auth/credentials"
import { jwtCallback, sessionCallback } from "@/lib/auth/session"

/**
 * The NODE-runtime half of auth. The Credentials provider lives HERE and
 * nowhere else.
 *
 * `src/auth.config.ts` is the edge-safe half: `src/middleware.ts` bundles it
 * for the edge runtime, which has no native modules and no Node built-ins.
 * Adding Credentials there would pull bcrypt into that bundle and break every
 * protected route at REQUEST time — with no type error and no failing test.
 * `tests/auth/edge-safety.test.ts` is what keeps that from happening quietly.
 *
 * Providers are MERGED, not replaced: GitHub keeps working.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      // `credentials` is declared only so Auth.js knows the field names; the
      // built-in sign-in page is not used (pages.signIn points at /login).
      credentials: {
        identifier: { label: "Email or handle", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: (raw) => authorizeCredentials(raw ?? {}),
    }),
  ],
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback,
  },
})
