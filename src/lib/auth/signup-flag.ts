/**
 * Is public credentials sign-up open?
 *
 * Off unless explicitly `true`. Decided with the user 2026-08-18, resolving
 * §10 of the design: there is **no password reset**, because there is no mail
 * provider — so a user who forgets their password is locked out permanently.
 * Behind a flag, the provider exists for a seeded dev account (which is what
 * lets an agent run its own live gates — BUILD-QUEUE trap 6) without offering
 * strangers an account they can lose forever.
 *
 * Flip it by setting CREDENTIALS_SIGNUP_ENABLED=true once email delivery
 * exists and reset is built.
 *
 * Note what this does NOT gate: signing IN. A seeded account must be able to
 * log in with the flag off, and an existing password user must not be locked
 * out by a config change.
 */
export function isSignupOpen(): boolean {
  return process.env.CREDENTIALS_SIGNUP_ENABLED === 'true'
}
