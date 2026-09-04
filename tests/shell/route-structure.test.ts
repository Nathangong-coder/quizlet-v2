import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const APP = join(ROOT, 'src', 'app')

/**
 * Routes that MUST render without the shell.
 *
 * Each entry is the page file's path relative to `src/app`, spelled WITHOUT the
 * `(app)` group. The assertion is that this exact file exists and that no
 * `(app)` variant of it does — so moving one into the group is caught here
 * rather than discovered when a nav rail turns up in a PDF export.
 *
 * The study activities are bare because a timed game with a navigation column
 * beside it is a game inviting you to leave, and because the two print views
 * have to be chrome-free for browser PDF export to be usable at all. The auth
 * pages are bare because they are pre-session and have nothing to navigate to.
 */
const BARE_ROUTES = [
  'sets/[id]/quiz/page.tsx',
  'sets/[id]/quiz/print/page.tsx',
  'sets/[id]/match/page.tsx',
  'sets/[id]/review/page.tsx',
  'sets/[id]/print/page.tsx',
  'login/page.tsx',
  'signup/page.tsx',
  'signup/check-email/page.tsx',
  'forgot/page.tsx',
  'reset/[token]/page.tsx',
  'verify/[token]/page.tsx',
]

/**
 * Routes that MUST be inside the group, i.e. must get the rail.
 */
const SHELLED_ROUTES = [
  'page.tsx',
  'browse/page.tsx',
  'sets/page.tsx',
  'sets/new/page.tsx',
  'sets/[id]/(views)/page.tsx',
  'sets/[id]/(views)/knowledge/page.tsx',
  'sets/[id]/(views)/analysis/page.tsx',
  'sets/[id]/edit/page.tsx',
  'sets/[id]/concepts/page.tsx',
  'profile/page.tsx',
  'profile/learner/page.tsx',
  'profile/memory/page.tsx',
  'profile/activity/[id]/page.tsx',
  'postmortem/page.tsx',
  'postmortem/new/page.tsx',
  'postmortem/[id]/page.tsx',
  'postmortem/[id]/edit/page.tsx',
  'diagnostic/page.tsx',
  'folders/page.tsx',
  'folders/new/page.tsx',
  'folders/[id]/page.tsx',
  'notes/page.tsx',
  'notes/new/page.tsx',
  'notes/[id]/page.tsx',
  'notes/[id]/edit/page.tsx',
  'account/page.tsx',
  'settings/ai/page.tsx',
  'settings/ai/[provider]/page.tsx',
  'settings/study/page.tsx',
  'staff/page.tsx',
  'staff/coverage/page.tsx',
  'staff/klps/page.tsx',
  'staff/learners/page.tsx',
  'staff/learners/[id]/page.tsx',
  'staff/roles/page.tsx',
  'help/page.tsx',
  'concepts/page.tsx',
]

describe('the shell covers exactly the routes it should', () => {
  for (const route of BARE_ROUTES) {
    it(`${route} renders bare`, () => {
      expect(existsSync(join(APP, route)), `${route} must exist outside (app)`).toBe(true)
      expect(
        existsSync(join(APP, '(app)', route)),
        `${route} must NOT be inside the (app) group — it would gain a nav rail`,
      ).toBe(false)
    })
  }

  for (const route of SHELLED_ROUTES) {
    it(`${route} is shelled`, () => {
      expect(existsSync(join(APP, '(app)', route)), `${route} must live inside (app)`).toBe(true)
      expect(
        existsSync(join(APP, route)),
        `${route} must NOT also exist outside (app) — Next.js would treat that as a duplicate route`,
      ).toBe(false)
    })
  }
})

/** Every page.tsx under src/app, as a path relative to src/app. */
function allPages(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'api') continue
      out.push(...allPages(full, prefix ? `${prefix}/${entry}` : entry))
    } else if (entry === 'page.tsx') {
      out.push(prefix ? `${prefix}/page.tsx` : 'page.tsx')
    }
  }
  return out
}

describe('no route escapes classification', () => {
  it('every page is either listed as bare or listed as shelled', () => {
    // WITHOUT THIS, the two lists above are a checklist nobody is required to
    // update: a new page added outside the group would silently render with no
    // navigation at all, and nothing would say so. This is the same failure
    // shape as ENFORCED_PATHS in the visibility suite.
    const classified = new Set([
      ...BARE_ROUTES,
      ...SHELLED_ROUTES.map((r) => `(app)/${r}`),
    ])
    const unclassified = allPages(APP).filter((p) => !classified.has(p))
    expect(unclassified, `add these to BARE_ROUTES or SHELLED_ROUTES: ${unclassified.join(', ')}`).toEqual([])
  })
})

/**
 * The set page's three views live in a `(views)` group so that `edit` and
 * `concepts` do NOT inherit their tab strip.
 *
 * A `layout.tsx` at `sets/[id]` — the obvious spelling — would wrap both. `edit`
 * is a long authoring form and `concepts` is a full-bleed drag-and-drop canvas;
 * a tab strip on either claims it is one of three peer views of the set, which
 * it is not. This is the same reason the study activities sit outside `(app)`.
 */
describe('set views are grouped so edit and concepts stay out', () => {
  const SETS = join(APP, '(app)', 'sets', '[id]')

  for (const view of ['page.tsx', 'knowledge/page.tsx', 'analysis/page.tsx']) {
    it(`${view} is inside (views)`, () => {
      expect(existsSync(join(SETS, '(views)', view)), `${view} must be in (views)`).toBe(true)
    })
  }

  it('supplies the tab strip from the group layout', () => {
    expect(existsSync(join(SETS, '(views)', 'layout.tsx'))).toBe(true)
  })

  for (const outside of ['edit/page.tsx', 'concepts/page.tsx']) {
    it(`${outside} is NOT inside (views)`, () => {
      expect(
        existsSync(join(SETS, '(views)', outside)),
        `${outside} must stay outside (views) — it would gain a tab strip`,
      ).toBe(false)
      expect(existsSync(join(SETS, outside)), `${outside} must still exist`).toBe(true)
    })
  }

  it('has NO layout.tsx directly at sets/[id]', () => {
    // Such a layout would wrap edit and concepts too, defeating the group.
    expect(existsSync(join(SETS, 'layout.tsx'))).toBe(false)
  })

  it('keeps the standalone concept editor reachable', () => {
    // Revised decision, 2026-08-28: Knowledge EMBEDS the canvas, it does not
    // replace the editor. The owner asked for the original tree to be preserved
    // at its own route.
    expect(existsSync(join(SETS, 'concepts', 'page.tsx'))).toBe(true)
  })
})

describe('the root layout supplies no chrome and no measure', () => {
  const root = readFileSync(join(APP, 'layout.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

  it('does not render a navbar', () => {
    expect(root).not.toContain('<Navbar')
  })

  it('does not impose a max-width on every page', () => {
    // The bug this whole restructure had to fix first: root applied
    // `max-w-6xl mx-auto px-4` and then every page applied its own on top.
    // Comments are stripped above, so the prose explaining this cannot satisfy
    // the assertion — that exact shape shipped a green-but-useless guard here
    // twice already.
    expect(root).not.toMatch(/max-w-\w+/)
    expect(root).not.toContain('mx-auto')
  })

  it('leaves the shell layout to own the measure', () => {
    const shell = readFileSync(join(APP, '(app)', 'layout.tsx'), 'utf8')
    expect(shell).toMatch(/max-w-/)
  })
})
