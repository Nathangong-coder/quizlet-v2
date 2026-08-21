/**
 * Barrel for the password-reset actions.
 *
 * DEVIATION (mirrors src/actions/auth-verify.ts, found via the same bug class):
 * this file used to carry the file-level 'use server' directive itself, but a
 * file marked 'use server' may only export async functions — Next.js rejects
 * a plain const export from such a file at compile time ("Only async
 * functions are allowed to be exported in a 'use server' file."). That was
 * never caught by tsc or vitest (neither enforces the Server Actions
 * convention), only by Turbopack at request time when this route first
 * rendered. A per-function 'use server' directive does not fix it either: a
 * file without a file-level directive that is imported directly by a Client
 * Component is bundled as an ordinary module, dragging `next/server`'s
 * `after` and `@/lib/db` into the browser bundle and failing the same way.
 *
 * Fixed by moving the three Server Actions into `auth-reset.server.ts` (which
 * keeps the file-level directive and exports only async functions) and
 * re-exporting them here, alongside the plain constant. No behavior change to
 * any action; ForgotForm/ResetPasswordForm and the reset route keep importing
 * from this same path.
 */
export {
  requestPasswordReset,
  peekResetToken,
  completePasswordReset,
} from './auth-reset.server'

export const FORGOT_FIXED_MESSAGE =
  'If that account exists, we’ve sent a link to its email address.'
