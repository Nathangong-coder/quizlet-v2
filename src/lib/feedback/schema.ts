import { z } from 'zod'

/**
 * What /help accepts.
 *
 * Every field is BOUNDED at both ends. This is the one endpoint in the app that
 * turns a stranger's text into an email to an operator's personal inbox, so an
 * unbounded `message` is both a mail-provider rejection waiting to happen and a
 * denial-of-inbox primitive.
 *
 * `.trim()` runs before the length checks, so a field of spaces fails `min(1)`
 * rather than passing as "1 character".
 */

export const FEEDBACK_LIMITS = {
  name: 80,
  email: 254, // RFC 5321 maximum path length; anything longer is not an address.
  subject: 120,
  message: 4000,
} as const

export const feedbackSchema = z.object({
  name: z.string().trim().min(1, 'Tell us your name.').max(FEEDBACK_LIMITS.name),
  email: z
    .string()
    .trim()
    .min(1, 'We need an address to reply to.')
    .max(FEEDBACK_LIMITS.email)
    .email('That does not look like an email address.'),
  subject: z.string().trim().min(1, 'Give it a subject.').max(FEEDBACK_LIMITS.subject),
  message: z
    .string()
    .trim()
    .min(1, 'Tell us what is going on.')
    .max(FEEDBACK_LIMITS.message, `Keep it under ${FEEDBACK_LIMITS.message} characters.`),
})

export type FeedbackInput = z.infer<typeof feedbackSchema>
