import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db"
import { authConfig } from "@/auth.config"
import { authorizeCredentials } from "@/lib/auth/credentials"
import { jwtCallback, sessionCallback } from "@/lib/auth/session"

/**
 * Thrown when the password was right but the address is not verified.
 *
 * RESOLVED empirically (Task 10 Step 6, against a running dev server on
 * next-auth@5.0.0-beta.31): the code DOES survive `signIn('credentials',
 * { redirect: false })` — but not on `res.error`, which Auth.js fixes to the
 * class-level string "CredentialsSignin" for every CredentialsSignin
 * subclass. The subclass signal rides on the separate `res.code` field
 * (@auth/core sets `code` on the redirect URL only `if (error instanceof
 * CredentialsSignin)`, using `error.code`). `src/components/auth/LoginForm.tsx`
 * reads `res.code ?? res.error` for exactly this reason.
 */
class UnverifiedEmailError extends CredentialsSignin {
  code = 'unverified'
}

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
      authorize: async (raw) => {
        const outcome = await authorizeCredentials(raw ?? {})
        if (outcome.kind === 'ok') return outcome.user
        if (outcome.kind === 'unverified') throw new UnverifiedEmailError()
        // `rejected` -> null -> Auth.js's generic CredentialsSignin, which the
        // login form renders as its one byte-identical failure message.
        return null
      },
    }),
  ],
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback,
  },
})
