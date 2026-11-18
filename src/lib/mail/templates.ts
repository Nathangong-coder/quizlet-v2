import type { MailMessage } from '@/lib/mail/transport'
import type { OwnerEvent } from '@/lib/notify/owner'

/** Pure — the interesting half of mail, so it can be unit-tested. */
export type MailBody = Omit<MailMessage, 'to'>

/** Minimal, because the only interpolated values are an origin and a token. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function linkBody(input: { heading: string; blurb: string; url: string; cta: string }): string {
  const safe = escapeHtml(input.url)
  return [
    `<p>${escapeHtml(input.heading)}</p>`,
    `<p>${escapeHtml(input.blurb)}</p>`,
    `<p><a href="${safe}">${escapeHtml(input.cta)}</a></p>`,
    `<p>${safe}</p>`,
  ].join('\n')
}

export function verifyEmailTemplate(input: { origin: string; token: string }): MailBody {
  const url = `${input.origin}/verify/${input.token}`
  return {
    subject: 'Verify your email address',
    text: [
      'Confirm your email address to finish setting up your account.',
      '',
      url,
      '',
      'This link works for 24 hours. If you did not create an account, ignore this message.',
    ].join('\n'),
    html: linkBody({
      heading: 'Confirm your email address to finish setting up your account.',
      blurb: 'This link works for 24 hours. If you did not create an account, ignore this message.',
      url,
      cta: 'Verify my email',
    }),
  }
}

/**
 * A message someone sent through /help, addressed to the operator.
 *
 * The sender's address is carried in `replyTo` by the caller; `from` stays the
 * verified sender. Sending AS the user is the obvious spelling and it bounces
 * every message, because providers reject an unverified from-address — and
 * `sendQuietly` swallows that bounce, so it would fail silently and completely.
 *
 * Every interpolated value here is USER-SUPPLIED free text, unlike the other
 * two templates whose only inputs are an origin and a token. `escapeHtml` on
 * each is therefore load-bearing rather than defensive: without it a subject
 * containing markup is injected into the operator's mail client.
 */
export function feedbackTemplate(input: {
  name: string
  email: string
  subject: string
  message: string
}): MailBody {
  return {
    subject: `[Feedback] ${input.subject}`,
    text: [
      `From: ${input.name} <${input.email}>`,
      `Subject: ${input.subject}`,
      '',
      input.message,
    ].join('\n'),
    html: [
      `<p><strong>From:</strong> ${escapeHtml(input.name)} &lt;${escapeHtml(input.email)}&gt;</p>`,
      `<p><strong>Subject:</strong> ${escapeHtml(input.subject)}</p>`,
      `<hr />`,
      // Newlines are the sender's paragraphing and the only structure a plain
      // textarea can express; dropping them turns a readable report into one
      // wall of text.
      `<p>${escapeHtml(input.message).replace(/\n/g, '<br />')}</p>`,
    ].join('\n'),
  }
}

export function passwordResetTemplate(input: { origin: string; token: string }): MailBody {
  const url = `${input.origin}/reset/${input.token}`
  return {
    subject: 'Reset your password',
    text: [
      'Choose a new password for your account.',
      '',
      url,
      '',
      'This link works for 1 hour and can be used once. If you did not ask for it, ignore this message — nothing has changed.',
    ].join('\n'),
    html: linkBody({
      heading: 'Choose a new password for your account.',
      blurb:
        'This link works for 1 hour and can be used once. If you did not ask for it, ignore this message — nothing has changed.',
      url,
      cta: 'Set a new password',
    }),
  }
}

/**
 * Tells the operator something happened that needs them — today, only a
 * guest asking to be invited from the demo.
 *
 * The email and note are USER-SUPPLIED (the email is validated, the note is
 * free text), so both are escaped in the html. The subject carries neither:
 * `sendQuietly` logs the subject at error level when delivery fails, and a
 * requester's address has no business in an error log.
 */
export function ownerNotificationTemplate(event: OwnerEvent): MailBody {
  const note = event.note ?? '(none)'
  return {
    subject: '[Waitlist] New invite request from the demo',
    text: [
      'Someone asked for an invite from the demo.',
      '',
      `Email: ${event.email}`,
      `Preparing for: ${note}`,
      '',
      'Reply to this message to answer them; mint a code with `npm run invite`.',
    ].join('\n'),
    html: [
      `<p>Someone asked for an invite from the demo.</p>`,
      `<p><strong>Email:</strong> ${escapeHtml(event.email)}</p>`,
      `<p><strong>Preparing for:</strong> ${escapeHtml(note)}</p>`,
      `<p>Reply to this message to answer them; mint a code with <code>npm run invite</code>.</p>`,
    ].join('\n'),
  }
}

/** The invite code itself, plus the way to use it. Pure. */
export function inviteTemplate(input: { origin: string; code: string }): MailBody {
  const url = `${input.origin}/signup`
  return {
    subject: 'Your invite code',
    text: [
      'You asked for an invite. Here is your code:',
      '',
      input.code,
      '',
      `Create your account at ${url}`,
      '',
      'The code works once and expires in 14 days.',
    ].join('\n'),
    html: [
      `<p>You asked for an invite. Here is your code:</p>`,
      `<p><strong>${escapeHtml(input.code)}</strong></p>`,
      `<p><a href="${escapeHtml(url)}">Create your account</a></p>`,
      `<p>The code works once and expires in 14 days.</p>`,
    ].join('\n'),
  }
}
