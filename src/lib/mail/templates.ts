import type { MailMessage } from '@/lib/mail/transport'

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
