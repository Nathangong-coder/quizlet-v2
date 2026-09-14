// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

afterEach(cleanup)

import { FEATURES, FEATURE_SLUGS, getFeature } from '@/lib/marketing/features'
import { MOCK_IDS } from '@/components/marketing/mocks'
import { FeaturePage } from '@/components/marketing/FeaturePage'

describe('feature registry', () => {
  it('lists the eight features in the order the owner gave', () => {
    expect(FEATURE_SLUGS).toEqual([
      'flashcards', 'learn', 'study-guides', 'postmortems', 'test', 'review', 'games', 'groups',
    ])
    expect(new Set(FEATURE_SLUGS).size).toBe(8)
  })

  it.each(FEATURES.map((f) => [f.slug, f] as const))('%s has three benefits and 2-4 sections', (_slug, f) => {
    expect(f.benefits).toHaveLength(3)
    expect(f.sections.length).toBeGreaterThanOrEqual(2)
    expect(f.sections.length).toBeLessThanOrEqual(4)
    expect(f.claim.length).toBeGreaterThan(10)
    expect(f.body.length).toBeGreaterThan(40)
  })

  it('references only mocks that exist', () => {
    for (const f of FEATURES) {
      expect(MOCK_IDS).toContain(f.heroMock)
      for (const s of f.sections) expect(MOCK_IDS).toContain(s.mock)
    }
  })

  it('marks exactly the unbuilt features as coming', () => {
    const coming = FEATURES.filter((f) => f.status === 'coming').map((f) => f.slug)
    expect(coming).toEqual(['learn'])
  })

  it('resolves a slug and rejects an unknown one', () => {
    expect(getFeature('test')?.label).toBe('Test')
    expect(getFeature('nope')).toBeNull()
  })

  it('never advertises voice — it is not built', () => {
    const text = JSON.stringify(FEATURES, (_k, v) => (typeof v === 'function' ? undefined : v))
    expect(text).not.toMatch(/\b(voice|spoken|speak)\b/i)
  })
})

describe('marketing files make no database read', () => {
  const files = [
    'src/lib/marketing/features.ts',
    'src/components/marketing/mocks.tsx',
    'src/components/marketing/FeaturePage.tsx',
    'src/app/(marketing)/features/page.tsx',
    'src/app/(marketing)/features/[slug]/page.tsx',
  ]
  it.each(files)('%s imports neither the Prisma client nor a server action', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    expect(source).not.toMatch(/from ['"]@\/lib\/db/)
    expect(source).not.toMatch(/from ['"]@prisma\/client/)
    expect(source).not.toMatch(/from ['"]@\/actions\//)
    expect(source).not.toMatch(/\bfetch\(/)
  })
})

describe('FeaturePage', () => {
  const env = process.env.CREDENTIALS_SIGNUP_ENABLED
  beforeEach(() => { delete process.env.CREDENTIALS_SIGNUP_ENABLED })
  afterEach(() => { if (env === undefined) delete process.env.CREDENTIALS_SIGNUP_ENABLED; else process.env.CREDENTIALS_SIGNUP_ENABLED = env })

  it.each(FEATURES.map((f) => [f.slug, f] as const))('%s renders its claim, benefits and sections', (_slug, f) => {
    render(<FeaturePage feature={f} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(f.claim)
    for (const b of f.benefits) expect(screen.getByText(b.title)).toBeTruthy()
    for (const s of f.sections) expect(screen.getByRole('heading', { level: 2, name: s.title })).toBeTruthy()
    // The strip of other features links to every OTHER page and not to itself.
    for (const other of FEATURES) {
      const links = screen.queryAllByRole('link', { name: new RegExp(`^${other.label}$`) })
      if (other.slug === f.slug) expect(links).toHaveLength(0)
      else expect(links[0]).toHaveAttribute('href', `/features/${other.slug}`)
    }
    cleanup()
  })

  it('shows the coming badge only where declared', () => {
    render(<FeaturePage feature={getFeature('learn')!} />)
    expect(screen.getAllByText(/coming/i).length).toBeGreaterThan(0)
    cleanup()
    render(<FeaturePage feature={getFeature('test')!} />)
    expect(screen.queryByText(/^coming$/i)).toBeNull()
  })

  it('hides sign-up when the flag is off and always offers browse', () => {
    render(<FeaturePage feature={getFeature('review')!} />)
    expect(screen.queryAllByRole('link', { name: /create an account/i })).toHaveLength(0)
    expect(screen.getAllByRole('link', { name: /browse published sets/i }).length).toBeGreaterThan(0)
  })
})

describe('feature route', () => {
  it('404s an unknown slug and statically lists the seven', async () => {
    const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND') })
    vi.doMock('next/navigation', () => ({ notFound }))
    const mod = await import('@/app/(marketing)/features/[slug]/page')
    expect(await mod.generateStaticParams()).toEqual(FEATURE_SLUGS.map((slug) => ({ slug })))
    await expect(mod.default({ params: Promise.resolve({ slug: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    vi.doUnmock('next/navigation')
  })
})
