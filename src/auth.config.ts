import type { NextAuthConfig } from 'next-auth'
import GitHub from 'next-auth/providers/github'

export const authConfig = {
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
  ],
  // Auth.js's built-in generated sign-in page cannot offer a password field
  // for a provider it does not know about — the Credentials provider lives in
  // the Node half (src/auth.ts). Pointing at the real page makes the
  // middleware redirect and any bare signIn() call land somewhere that can
  // sign you in.
  pages: {
    signIn: '/login',
  },
} satisfies NextAuthConfig
