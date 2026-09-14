// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

afterEach(() => { cleanup(); try { window.localStorage.clear() } catch { /* ignore */ } })

import { checkSpam, MIN_SUBMIT_MS, MAX_FORM_AGE_MS, HONEYPOT_FIELD } from '@/lib/forms/spam'
import { parseConsent, serializeConsent, analyticsAllowed, CONSENT_VERSION } from '@/lib/consent/consent'
import { SECURITY_HEADERS } from '../../next.config'
import robots from '@/app/robots'
import NotFound from '@/app/not-found'
import { MarketingHeader } from '@/components/marketing/MarketingHeader'
import { STUDY_TOOLS, SUBJECT_LINKS } from '@/lib/marketing/nav'

/**
 * The launch checklist, as tests: spam protection, consent, security
 * headers, robots, the 404, the marketing header, and the presence of the
 * SEO files. Each one is the guard for a checklist line.
 */

describe('spam protection (honeypot + clock)', () => {
  const now = 1_000_000_000
  it('passes a person: empty honeypot, a few seconds after render', () => {
    expect(checkSpam({ honeypot: '', renderedAt: now - 5000 }, now)).toEqual({ ok: true })
  })
  it('trips on a filled honeypot', () => {
    expect(checkSpam({ honeypot: 'http://spam', renderedAt: now - 5000 }, now)).toEqual({ ok: false, reason: 'honeypot' })
  })
  it('trips on a submission faster than a person could type', () => {
    expect(checkSpam({ honeypot: '', renderedAt: now - (MIN_SUBMIT_MS - 1) }, now)).toEqual({ ok: false, reason: 'too_fast' })
  })
  it('trips on an impossible clock, but not on a form left open for hours', () => {
    expect(checkSpam({ honeypot: '', renderedAt: now + 1000 }, now)).toEqual({ ok: false, reason: 'bad_clock' })
    expect(checkSpam({ honeypot: '', renderedAt: now - MAX_FORM_AGE_MS - 1 }, now)).toEqual({ ok: false, reason: 'bad_clock' })
    expect(checkSpam({ honeypot: '', renderedAt: now - 3 * 60 * 60 * 1000 }, now)).toEqual({ ok: true })
  })
  it('treats missing signals as trusted (signed-in and internal callers)', () => {
    expect(checkSpam(undefined, now)).toEqual({ ok: true })
    expect(checkSpam({}, now)).toEqual({ ok: true })
  })
  it('is wired into every public form and its action', () => {
    for (const f of ['src/components/auth/SignUpForm.tsx', 'src/components/auth/ForgotForm.tsx', 'src/components/help/FeedbackForm.tsx']) {
      expect(readFileSync(join(process.cwd(), f), 'utf8'), f).toMatch(/useSpamSignals/)
    }
    for (const f of ['src/actions/auth-signup.ts', 'src/actions/auth-reset.server.ts', 'src/actions/feedback.ts']) {
      expect(readFileSync(join(process.cwd(), f), 'utf8'), f).toMatch(/checkSpam\(/)
    }
    expect(HONEYPOT_FIELD).not.toMatch(/honeypot|trap|bot/i)
  })
})

describe('cookie consent', () => {
  it('round-trips a choice and rejects a stale version or garbage', () => {
    const rec = parseConsent(serializeConsent('all', new Date('2026-09-13T00:00:00Z')))
    expect(rec).toEqual({ version: CONSENT_VERSION, choice: 'all', decidedAt: '2026-09-13T00:00:00.000Z' })
    expect(analyticsAllowed(rec)).toBe(true)
    expect(analyticsAllowed(parseConsent(serializeConsent('essential')))).toBe(false)
    expect(parseConsent(null)).toBeNull()
    expect(parseConsent('{')).toBeNull()
    expect(parseConsent(JSON.stringify({ version: CONSENT_VERSION + 1, choice: 'all', decidedAt: 'x' }))).toBeNull()
    expect(parseConsent(JSON.stringify({ version: CONSENT_VERSION, choice: 'everything', decidedAt: 'x' }))).toBeNull()
  })
  it('analytics never mounts without an explicit "all"', () => {
    expect(analyticsAllowed(null)).toBe(false)
  })
})

describe('security headers', () => {
  it('force HTTPS with HSTS and set the standard guards', () => {
    const get = (k: string) => SECURITY_HEADERS.find((h) => h.key === k)?.value
    expect(get('Strict-Transport-Security')).toMatch(/max-age=\d{7,}/)
    expect(get('X-Content-Type-Options')).toBe('nosniff')
    expect(get('X-Frame-Options')).toBe('SAMEORIGIN')
    expect(get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    // Voice (Stage 4) needs the microphone; do not deny it.
    expect(get('Permissions-Policy')).not.toMatch(/microphone/)
  })
})

describe('robots and sitemap', () => {
  it('allows the public site, disallows account and study routes, and names the sitemap', () => {
    const r = robots()
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules
    expect(rule.allow).toBe('/')
    for (const p of ['/api/', '/account', '/settings', '/staff', '/sets/*/edit', '/sets/*/quiz']) expect(rule.disallow).toContain(p)
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/)
  })
  it('the SEO and icon files exist', () => {
    for (const f of ['src/app/sitemap.ts', 'src/app/robots.ts', 'src/app/opengraph-image.tsx', 'src/app/apple-icon.tsx', 'src/app/icon.svg', 'src/app/not-found.tsx']) {
      expect(existsSync(join(process.cwd(), f)), f).toBe(true)
    }
  })
  it('the root layout sets a title template, description, Open Graph and Twitter card', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8')
    expect(src).toMatch(/template: TITLE_TEMPLATE/)
    expect(src).toMatch(/openGraph:/)
    expect(src).toMatch(/twitter:/)
    expect(src).toMatch(/metadataBase/)
  })
})

describe('404 page', () => {
  it('explains and offers home, browse and the library, with no data read', () => {
    render(<NotFound />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/not here/i)
    expect(screen.getByRole('link', { name: /go home/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /browse/i })).toHaveAttribute('href', '/browse')
    const src = readFileSync(join(process.cwd(), 'src/app/not-found.tsx'), 'utf8')
    expect(src).not.toMatch(/@\/lib\/db|@\/actions\//)
  })
})

describe('marketing header', () => {
  it('opens Study tools and Subjects as disclosure menus and searches into Browse', () => {
    render(<MarketingHeader signupOpen={false} tools={STUDY_TOOLS} subjects={SUBJECT_LINKS} />)
    const tools = screen.getByRole('button', { name: /study tools/i })
    expect(tools).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(tools)
    expect(tools).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: /flashcards/i })).toHaveAttribute('href', '/features/flashcards')
    expect(screen.getByRole('link', { name: /study groups/i })).toHaveAttribute('href', '/features/groups')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(tools).toHaveAttribute('aria-expanded', 'false')
    const search = screen.getAllByRole('searchbox')[0]
    expect(search.closest('form')).toHaveAttribute('action', '/browse')
    expect(search).toHaveAttribute('name', 'q')
    // Create goes to sign-in when sign-up is closed.
    expect(screen.getByRole('link', { name: /create/i })).toHaveAttribute('href', '/login')
  })
  it('sends Create to sign-up when it is open', () => {
    render(<MarketingHeader signupOpen tools={STUDY_TOOLS} subjects={SUBJECT_LINKS} />)
    expect(screen.getByRole('link', { name: /create/i })).toHaveAttribute('href', '/signup')
  })
})

describe('legal pages', () => {
  it('exist, name the operator, a contact address and a governing law — no placeholders left', () => {
    for (const f of ['src/app/(marketing)/privacy/page.tsx', 'src/app/(marketing)/terms/page.tsx', 'src/app/(marketing)/cookies/page.tsx']) {
      expect(existsSync(join(process.cwd(), f)), f).toBe(true)
    }
    const privacy = readFileSync(join(process.cwd(), 'src/app/(marketing)/privacy/page.tsx'), 'utf8')
    const terms = readFileSync(join(process.cwd(), 'src/app/(marketing)/terms/page.tsx'), 'utf8')
    for (const src of [privacy, terms]) expect(src).not.toMatch(/\[[a-z ]+\]/)
    expect(privacy).toMatch(/mailto:ngong7053@gmail.com/)
    expect(terms).toMatch(/governed by the law of <strong>the United States/)
  })
})

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/' }))
