export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
  /**
   * Where a reply should go, when that is not the sender.
   *
   * Exists for feedback, and it is not a nicety. The `from` address must be one
   * the provider has verified for this domain — Resend rejects anything else
   * outright — so a feedback mail cannot be sent AS the person who wrote it. It
   * is sent as us, replying to them. Without this field the operator would have
   * to copy the address out of the body by hand every time.
   *
   * Optional: verification and reset mail should be replied to by nobody.
   */
  replyTo?: string
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>
}

/**
 * Resend over plain `fetch`.
 *
 * No `resend` npm dependency, deliberately: their API is one POST, wrapping it
 * is ten lines, and this keeps the transport swappable. Also keeps the module
 * edge-safe — it imports nothing.
 *
 * This THROWS on failure. Deciding to swallow is `send.ts`'s job, because only
 * it knows the call is happening inside `after()`.
 */
export function resendTransport(apiKey: string, from: string): MailTransport {
  return {
    async send(message) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          // Omitted entirely when absent rather than sent as null — Resend
          // treats an explicit null as a value and rejects the payload.
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      })
      if (!res.ok) {
        throw new Error(`Resend rejected the message: ${res.status} ${await res.text()}`)
      }
    },
  }
}

/**
 * A design goal, not a dev convenience.
 *
 * With RESEND_API_KEY absent, verification and reset links print to the server
 * log — so an agent can drive this whole feature end to end locally by reading
 * links out of stdout, with no inbox involved.
 */
export const consoleTransport: MailTransport = {
  async send(message) {
    console.log(
      ['[mail] (console transport — no RESEND_API_KEY set)',
       `  to:      ${message.to}`,
       ...(message.replyTo ? [`  replyTo: ${message.replyTo}`] : []),
       `  subject: ${message.subject}`,
       message.text].join('\n'),
    )
  },
}
