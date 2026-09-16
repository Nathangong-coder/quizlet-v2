// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

afterEach(cleanup)

import { Landing } from '@/components/home/Landing'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { FOOTER_COLUMNS, STUDY_TOOLS, SUBJECT_LINKS, PUBLIC_STATIC_PATHS } from '@/lib/marketing/nav'
import { FEATURES } from '@/lib/marketing/features'

describe('Landing makes no database read', () => {
  // The page renders for every anonymous hit including crawlers, so it must
  // stay a pure render. A source scan is the only guard that fails at the
  // moment someone adds the import, rather than at the moment the database
  // falls over under crawler load.
  const files = [
    'src/components/home/Landing.tsx',
    'src/components/marketing/MarketingHeader.tsx',
    'src/components/marketing/SiteFooter.tsx',
    'src/lib/marketing/nav.ts',
  ]

  it.each(files)('%s imports neither the Prisma client nor a server action', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    expect(source).not.toMatch(/from ['"]@\/lib\/db/)
    expect(source).not.toMatch(/from ['"]@prisma\/client/)
    expect(source).not.toMatch(/from ['"]@\/actions\//)
    expect(source).not.toMatch(/\bfetch\(/)
  })
})

describe('Landing', () => {
  const env = process.env.CREDENTIALS_SIGNUP_ENABLED
  beforeEach(() => { delete process.env.CREDENTIALS_SIGNUP_ENABLED })
  afterEach(() => { if (env === undefined) delete process.env.CREDENTIALS_SIGNUP_ENABLED; else process.env.CREDENTIALS_SIGNUP_ENABLED = env })

  it('has ONE call to action — sign in when sign-up is closed, sign up when open — repeated only in the closing block', () => {
    render(<Landing />)
    expect(screen.queryAllByRole('link', { name: /sign up for free/i })).toHaveLength(0)
    expect(screen.getAllByRole('link', { name: /^sign in$/i })).toHaveLength(2)
    cleanup()
    process.env.CREDENTIALS_SIGNUP_ENABLED = 'true'
    render(<Landing />)
    expect(screen.getAllByRole('link', { name: /sign up for free/i })).toHaveLength(2)
    expect(screen.queryAllByRole('link', { name: /^sign in$/i })).toHaveLength(0)
  })

  it('offers browse as a text link that needs no account', () => {
    render(<Landing />)
    expect(screen.getByRole('link', { name: /browse published sets/i })).toHaveAttribute('href', '/browse')
  })

  it('shows every study tool as a gallery, each linking to its feature page, with Coming on the unbuilt one', () => {
    render(<Landing />)
    const tools = screen.getByRole('region', { name: /study tools/i })
    const links = tools.querySelectorAll('a')
    expect(links).toHaveLength(FEATURES.length)
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(FEATURES.map((f) => `/features/${f.slug}`))
    expect(tools.textContent).toMatch(/Coming/)
    // A horizontal strip, not a grid: it scrolls sideways so every tool fits.
    expect(tools.querySelector('ul')?.className).toMatch(/overflow-x-auto/)
  })

  it('does not advertise voice — it is not built', () => {
    render(<Landing />)
    expect(document.body.textContent).not.toMatch(/\b(voice|spoken|speak)\b/i)
  })
})

describe('navigation data', () => {
  it('Study tools lists every feature (study groups is one of them now); Subjects lists every group', () => {
    expect(STUDY_TOOLS.map((l) => l.href)).toEqual(FEATURES.map((f) => `/features/${f.slug}`))
    expect(STUDY_TOOLS.some((l) => l.href === '/features/groups')).toBe(true)
    expect(SUBJECT_LINKS.every((l) => l.href.startsWith('/browse?subject='))).toBe(true)
    expect(SUBJECT_LINKS.length).toBe(9)
  })

  it('the footer carries the legal pages and the sitemap lists them', () => {
    const legal = FOOTER_COLUMNS.find((c) => c.heading === 'Legal')!
    expect(legal.links.map((l) => l.href)).toEqual(['/privacy', '/terms', '/cookies'])
    for (const p of ['/privacy', '/terms', '/cookies', '/', '/browse', '/features']) expect(PUBLIC_STATIC_PATHS).toContain(p)
  })

  it('renders the footer with every column as a labelled nav', () => {
    render(<SiteFooter />)
    for (const c of FOOTER_COLUMNS) expect(screen.getByRole('navigation', { name: c.heading })).toBeTruthy()
    expect(screen.getByText(/© \d{4} synapseHQ/)).toBeTruthy()
    // No fake language selector.
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
