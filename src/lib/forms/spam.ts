/**
 * Spam protection for public forms, with no keys and no CAPTCHA UX.
 *
 * Two signals a bot trips and a person never does:
 *  - the HONEYPOT: a text field named like something a bot wants to fill,
 *    hidden from people (off-screen, `tabIndex=-1`, `autoComplete="off"`,
 *    `aria-hidden`). A person leaves it empty; a form-filler fills it.
 *  - the CLOCK: the form records when it was rendered; a submission that
 *    arrives within MIN_SUBMIT_MS of that is not a person typing an email
 *    and a password.
 *
 * Both travel with the submission as `SpamSignals`. `checkSpam` is pure so
 * the thresholds are tested; the actions call it before doing anything
 * else. A tripped check returns a GENERIC error — telling a bot which
 * signal caught it is telling it what to fix.
 *
 * Turnstile/reCAPTCHA can be layered on later if real spam appears; this is
 * the cheap first line, not the last.
 */

/** Named to look like a real field to a form-filler. Never rendered visibly. */
export const HONEYPOT_FIELD = 'website'
export const MIN_SUBMIT_MS = 1500
/** A form left open for days is still a person; only a negative or absurd future clock is suspicious. */
export const MAX_FORM_AGE_MS = 1000 * 60 * 60 * 24 * 7

export interface SpamSignals {
  /** The honeypot's value; empty for a person. */
  honeypot?: string
  /** `Date.now()` when the form rendered, as the client saw it. */
  renderedAt?: number
}

export type SpamCheck = { ok: true } | { ok: false; reason: 'honeypot' | 'too_fast' | 'bad_clock' }

export function checkSpam(signals: SpamSignals | undefined, now: number = Date.now()): SpamCheck {
  if (!signals) return { ok: true } // a caller that sends nothing is a trusted (signed-in, internal) path
  if (signals.honeypot && signals.honeypot.trim().length > 0) return { ok: false, reason: 'honeypot' }
  if (typeof signals.renderedAt === 'number') {
    const age = now - signals.renderedAt
    if (age < 0 || age > MAX_FORM_AGE_MS) return { ok: false, reason: 'bad_clock' }
    if (age < MIN_SUBMIT_MS) return { ok: false, reason: 'too_fast' }
  }
  return { ok: true }
}

/** The one message every tripped check returns. Generic on purpose. */
export const SPAM_REJECTION_MESSAGE = 'Something went wrong sending that. Please try again.'
