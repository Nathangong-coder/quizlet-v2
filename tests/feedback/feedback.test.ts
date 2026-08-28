import { describe, it, expect } from 'vitest'
import { feedbackSchema, FEEDBACK_LIMITS } from '@/lib/feedback/schema'
import {
  withinFeedbackRate,
  feedbackWindowStart,
  FEEDBACK_MAX_PER_HOUR,
  FEEDBACK_WINDOW_MS,
} from '@/lib/feedback/rate'
import { feedbackTemplate } from '@/lib/mail/templates'

const valid = {
  name: 'Alice',
  email: 'alice@example.com',
  subject: 'Matching game timer',
  message: 'The timer keeps running after I finish.',
}

describe('feedbackSchema', () => {
  it('accepts a well-formed message', () => {
    expect(feedbackSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a whitespace-only field rather than storing it as one character', () => {
    for (const field of ['name', 'subject', 'message'] as const) {
      expect(feedbackSchema.safeParse({ ...valid, [field]: '   ' }).success).toBe(false)
    }
  })

  it('trims before storing', () => {
    const out = feedbackSchema.parse({ ...valid, name: '  Alice  ' })
    expect(out.name).toBe('Alice')
  })

  it('rejects a malformed email', () => {
    expect(feedbackSchema.safeParse({ ...valid, email: 'not-an-address' }).success).toBe(false)
  })

  it('bounds every field at the top end', () => {
    // This endpoint turns a stranger's text into mail to an operator's personal
    // inbox. An unbounded message is a provider rejection waiting to happen and
    // a denial-of-inbox primitive.
    for (const [field, limit] of Object.entries(FEEDBACK_LIMITS)) {
      const over = { ...valid, [field]: field === 'email' ? `${'a'.repeat(limit)}@b.co` : 'a'.repeat(limit + 1) }
      expect(feedbackSchema.safeParse(over).success, `${field} must be bounded`).toBe(false)
    }
  })

  it('accepts a message exactly at the limit', () => {
    expect(feedbackSchema.safeParse({ ...valid, message: 'a'.repeat(FEEDBACK_LIMITS.message) }).success).toBe(true)
  })
})

describe('withinFeedbackRate', () => {
  it('allows up to the limit and refuses beyond it', () => {
    expect(withinFeedbackRate(0)).toBe(true)
    expect(withinFeedbackRate(FEEDBACK_MAX_PER_HOUR - 1)).toBe(true)
    // STRICTLY LESS THAN. `<=` here makes the real limit six while every string
    // in the UI says five — an off-by-one nobody notices because both numbers
    // look reasonable.
    expect(withinFeedbackRate(FEEDBACK_MAX_PER_HOUR)).toBe(false)
    expect(withinFeedbackRate(FEEDBACK_MAX_PER_HOUR + 1)).toBe(false)
  })
})

describe('feedbackWindowStart', () => {
  it('is exactly one hour before the given moment', () => {
    const now = new Date('2026-08-28T12:00:00.000Z')
    expect(feedbackWindowStart(now).toISOString()).toBe('2026-08-28T11:00:00.000Z')
    expect(FEEDBACK_WINDOW_MS).toBe(3_600_000)
  })
})

describe('feedbackTemplate', () => {
  it('escapes user-supplied text in the HTML body', () => {
    // Unlike the other two templates, every value here is free text a stranger
    // typed. Escaping is load-bearing, not defensive.
    const body = feedbackTemplate({
      ...valid,
      subject: '<script>alert(1)</script>',
      message: '<img src=x onerror=alert(1)>',
    })
    expect(body.html).not.toContain('<script>')
    expect(body.html).not.toContain('<img src=x')
    expect(body.html).toContain('&lt;script&gt;')
  })

  it('keeps the sender address in the body so a broken reply-to is recoverable', () => {
    const body = feedbackTemplate(valid)
    expect(body.text).toContain('alice@example.com')
  })

  it('preserves the sender paragraphing', () => {
    const body = feedbackTemplate({ ...valid, message: 'one\ntwo' })
    expect(body.html).toContain('<br />')
  })

  it('marks the subject so it can be filtered in a mailbox', () => {
    expect(feedbackTemplate(valid).subject).toContain('Matching game timer')
    expect(feedbackTemplate(valid).subject).toContain('Feedback')
  })
})
