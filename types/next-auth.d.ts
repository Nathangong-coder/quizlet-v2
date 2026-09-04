import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      /** USER_ROLES in src/lib/auth/roles.ts. Always present; 'learner' by default. */
      role: string
    } & DefaultSession["user"]
  }
}
