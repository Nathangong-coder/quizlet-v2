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
