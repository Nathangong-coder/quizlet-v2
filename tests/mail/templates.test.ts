import { describe, it, expect } from 'vitest'
import { verifyEmailTemplate, passwordResetTemplate } from '@/lib/mail/templates'

const ORIGIN = 'https://study.example.com'
const TOKEN = 'abc-123_XYZ'

describe('verifyEmailTemplate', () => {
  it('carries an ABSOLUTE link to /verify/<token> in both text and html', () => {
    const t = verifyEmailTemplate({ origin: ORIGIN, token: TOKEN })
    const link = `${ORIGIN}/verify/${TOKEN}`
    expect(t.text).toContain(link)
    expect(t.html).toContain(link)
  })

  it('has a subject that says what it is', () => {
    expect(verifyEmailTemplate({ origin: ORIGIN, token: TOKEN }).subject).toMatch(/verify/i)
  })

  it('names the 24-hour window', () => {
    expect(verifyEmailTemplate({ origin: ORIGIN, token: TOKEN }).text).toMatch(/24 hours/)
  })
})

describe('passwordResetTemplate', () => {
  it('carries an ABSOLUTE link to /reset/<token>, not /verify/', () => {
    const t = passwordResetTemplate({ origin: ORIGIN, token: TOKEN })
    expect(t.text).toContain(`${ORIGIN}/reset/${TOKEN}`)
    expect(t.html).toContain(`${ORIGIN}/reset/${TOKEN}`)
    expect(t.text).not.toContain('/verify/')
  })

  it('names the 1-hour window', () => {
    expect(passwordResetTemplate({ origin: ORIGIN, token: TOKEN }).text).toMatch(/1 hour/)
  })

  it('tells a recipient who did not ask that they need do nothing', () => {
    // The mail goes to an address someone else may have typed.
    expect(passwordResetTemplate({ origin: ORIGIN, token: TOKEN }).text).toMatch(/ignore/i)
  })
})

describe('both templates', () => {
  it('escape the token before putting it in an href attribute', () => {
    const t = verifyEmailTemplate({ origin: ORIGIN, token: 'a"onmouseover="x' })
    expect(t.html).not.toContain('onmouseover="x"')
  })
})
