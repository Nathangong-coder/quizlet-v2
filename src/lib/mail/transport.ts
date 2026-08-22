export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
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
       `  subject: ${message.subject}`,
       message.text].join('\n'),
    )
  },
}
