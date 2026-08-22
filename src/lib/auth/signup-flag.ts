/**
 * Is public credentials sign-up open?
 *
 * A MASTER KILL SWITCH, not the primary control. Invite codes are the cap on
 * how many accounts can exist (src/lib/invites/); this flag is how you close
 * the door entirely without a deploy.
 *
 * Off unless explicitly `true`. Its original reason — "there is no password
 * reset" — no longer holds: /forgot and /reset/[token] exist, and sign-up now
 * requires an invite code and a verified email address. Flipping it to `true`
 * is a deliberate human decision about opening the app to strangers, not a
 * missing feature.
 *
 * Note what this does NOT gate: signing IN, resetting a password, or verifying
 * an address. A seeded account must be able to log in with the flag off, and an
 * existing user must never be locked out by a config change.
 */
export function isSignupOpen(): boolean {
  return process.env.CREDENTIALS_SIGNUP_ENABLED === 'true'
}
