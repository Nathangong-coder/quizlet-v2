// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

afterEach(cleanup)

import { Landing } from '@/components/home/Landing'
import { FeatureShowcase, SHOWCASE_TABS } from '@/components/home/FeatureShowcase'

describe('Landing makes no database read', () => {
  // The page renders for every anonymous hit including crawlers, so it must
  // stay a pure render. A source scan is the only guard that fails at the
  // moment someone adds the import, rather than at the moment the database
  // falls over under crawler load.
  const files = ['src/components/home/Landing.tsx', 'src/components/home/FeatureShowcase.tsx']

  it.each(files)('%s imports neither the Prisma client nor a server action', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    // Import statements only: the doc comment in Landing.tsx names these
    // modules to say they are forbidden, and a scan that matched prose would
    // fail on its own explanation.
    expect(source).not.toMatch(/from ['"]@\/lib\/db/)
    expect(source).not.toMatch(/from ['"]@prisma\/client/)
    expect(source).not.toMatch(/from ['"]@\/actions\//)
    expect(source).not.toMatch(/\bfetch\(/)
  })
})

describe('Landing links', () => {
  const env = process.env.CREDENTIALS_SIGNUP_ENABLED
  beforeEach(() => { delete process.env.CREDENTIALS_SIGNUP_ENABLED })
  afterEach(() => { if (env === undefined) delete process.env.CREDENTIALS_SIGNUP_ENABLED; else process.env.CREDENTIALS_SIGNUP_ENABLED = env })

  it('hides every sign-up link when the flag is off, because /signup 404s', () => {
    render(<Landing />)
    expect(screen.queryAllByRole('link', { name: /create an account/i })).toHaveLength(0)
    expect(screen.getAllByRole('link', { name: /^sign in$/i }).length).toBeGreaterThan(0)
  })

  it('shows sign-up in both the hero and the closing call when the flag is on', () => {
    process.env.CREDENTIALS_SIGNUP_ENABLED = 'true'
    render(<Landing />)
    expect(screen.getAllByRole('link', { name: /create an account/i })).toHaveLength(2)
  })

  it('always offers the one link that needs no account', () => {
    render(<Landing />)
    const browse = screen.getAllByRole('link', { name: /browse published sets/i })
    expect(browse.length).toBeGreaterThan(0)
    for (const a of browse) expect(a).toHaveAttribute('href', '/browse')
  })

  it('does not advertise voice — it is not built', () => {
    render(<Landing />)
    expect(document.body.textContent).not.toMatch(/\b(voice|spoken|speak)\b/i)
  })
})

describe('FeatureShowcase tabs', () => {
  it('names every way of studying that the app actually has', () => {
    expect(SHOWCASE_TABS.map((t) => t.id)).toEqual([
      'short-answer', 'key-points', 'concept-tree', 'insights', 'memory', 'diagnostic',
    ])
  })

  it('opens on the first tab with its panel, and only that panel, rendered', () => {
    render(<FeatureShowcase />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(SHOWCASE_TABS.length)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0].id)
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(SHOWCASE_TABS[0].claim)
  })

  it('switches the panel on click', () => {
    render(<FeatureShowcase />)
    fireEvent.click(screen.getByRole('tab', { name: /concept tree/i }))
    expect(screen.getByRole('tab', { name: /concept tree/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(SHOWCASE_TABS[2].claim)
  })

  it('moves selection with the arrow keys and wraps, per the ARIA tabs pattern', () => {
    render(<FeatureShowcase />)
    const tabs = screen.getAllByRole('tab')
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(SHOWCASE_TABS[1].claim)
    fireEvent.keyDown(tabs[1], { key: 'ArrowLeft' })
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' })
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(SHOWCASE_TABS[SHOWCASE_TABS.length - 1].claim)
    fireEvent.keyDown(tabs[SHOWCASE_TABS.length - 1], { key: 'Home' })
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(SHOWCASE_TABS[0].claim)
  })

  it('keeps one tab stop in the list — only the selected tab is focusable', () => {
    render(<FeatureShowcase />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1)
  })
})
