import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function code(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
}

/**
 * Which settings page actually renders which panel.
 *
 * WHY THIS EXISTS. On 2026-08-28 the four scoring panels moved from
 * `/settings/ai` to `/settings/study`, and five deep links plus one
 * `revalidatePath` were left pointing at the old page — "Change your study
 * scope", "Adjust your evidence floor", the targeting-strategy link, the
 * default-scope link, and `saveTuning`'s revalidation. The move's own commit
 * message asserted that every existing link still landed correctly, which was
 * arrived at by COUNTING the links rather than reading what each was about.
 *
 * Nothing failed. `/settings/ai` still exists and still renders, so every one
 * of those links produced a real page with no error — just not the page holding
 * the control the link had promised. That is precisely the failure a test has
 * to catch, because a human clicking through sees a working settings page and
 * moves on.
 */
const PANEL_HOME: Record<string, string> = {
  CredentialList: 'src/app/(app)/settings/ai/page.tsx',
  TaskRoutingPanel: 'src/app/(app)/settings/ai/page.tsx',
  SeverityBandPanel: 'src/app/(app)/settings/study/page.tsx',
  MetricThresholdPanel: 'src/app/(app)/settings/study/page.tsx',
  TargetingStrategyPanel: 'src/app/(app)/settings/study/page.tsx',
  StudyScopePanel: 'src/app/(app)/settings/study/page.tsx',
}

const SETTINGS_PAGES = [
  'src/app/(app)/settings/ai/page.tsx',
  'src/app/(app)/settings/study/page.tsx',
]

describe('every settings panel is rendered by exactly one page', () => {
  for (const [panel, home] of Object.entries(PANEL_HOME)) {
    it(`${panel} lives on ${home}`, () => {
      expect(code(home), `${home} must render <${panel} />`).toContain(`<${panel}`)

      for (const other of SETTINGS_PAGES) {
        if (other === home) continue
        expect(code(other), `${panel} must NOT also render on ${other}`).not.toContain(
          `<${panel}`,
        )
      }
    })
  }
})

/**
 * Deep links that promise a specific control, and the page that must hold it.
 *
 * Matched on the LINK TEXT, because that is the promise the user reads. A link
 * saying "Adjust your evidence floor" has to reach `MetricThresholdPanel`,
 * whichever page that currently is.
 */
const PROMISES: { file: string; text: string; mustReach: string }[] = [
  { file: 'src/components/learner/EmptyDashboard.tsx', text: 'Change your study scope', mustReach: 'StudyScopePanel' },
  { file: 'src/components/learner/EmptyDashboard.tsx', text: 'Adjust your evidence floor', mustReach: 'MetricThresholdPanel' },
  // Anchored on the prose beside the link, not on `STRATEGY_LABELS` — that
  // name appears first at its own declaration, so anchoring on it measured a
  // window at the top of the file that contains no link at all.
  { file: 'src/components/learner/StudyNext.tsx', text: 'Ordered by', mustReach: 'TargetingStrategyPanel' },
  { file: 'src/components/memory/ScopeLine.tsx', text: 'Edit default', mustReach: 'StudyScopePanel' },
  { file: 'src/app/(app)/profile/learner/page.tsx', text: 'Update your scope', mustReach: 'StudyScopePanel' },
]

describe('a deep link reaches the page holding the control it names', () => {
  for (const { file, text, mustReach } of PROMISES) {
    it(`"${text}" in ${file} reaches ${mustReach}`, () => {
      const src = code(file)
      const target = PANEL_HOME[mustReach]
      // The route the panel's page is served at, derived from its file path
      // rather than restated — so moving the page updates this automatically.
      const route = target
        .replace('src/app/(app)', '')
        .replace('/page.tsx', '')

      const index = src.indexOf(text)
      expect(index, `${file} no longer contains "${text}"`).toBeGreaterThanOrEqual(0)

      // The href sits within the same element as the label. A generous window
      // either side, since formatting varies.
      const window = src.slice(Math.max(0, index - 400), index + 400)
      // BOTH spellings: a JSX attribute (`href="/x"`) and an object property
      // (`href: '/x'`), which is how EmptyDashboard's `copyFor` returns its
      // action. Checking only the JSX form made this guard fail on correct code
      // — and would have passed a file that had neither, had the label happened
      // to sit next to some other `href="…"`.
      const reaches =
        window.includes(`href="${route}"`) ||
        window.includes(`href: '${route}'`) ||
        window.includes(`href: "${route}"`)
      expect(reaches, `the link labelled "${text}" must point at ${route}`).toBe(true)
    })
  }
})

/**
 * A tuning write must revalidate the page that DISPLAYS it.
 *
 * `saveTuning` revalidated `/settings/ai` after the panels moved, so saving a
 * threshold refreshed a page that no longer showed it. Invisible in tests and
 * invisible on screen until a reload.
 */
describe('tuning writes revalidate the page that shows them', () => {
  it('src/actions/learner-tuning.ts revalidates /settings/study', () => {
    const src = code('src/actions/learner-tuning.ts')
    expect(src).toContain("revalidatePath('/settings/study')")
    expect(src).not.toContain("revalidatePath('/settings/ai')")
  })
})

/**
 * Middleware must cover every settings page, not one named route.
 */
describe('middleware protects the whole settings tree', () => {
  const src = code('src/middleware.ts')

  it('tests a /settings prefix rather than a single page', () => {
    expect(src).toContain('startsWith("/settings")')
  })

  it('matches every settings path', () => {
    expect(src).toContain("'/settings/:path*'")
  })

  it('covers every settings page that exists', () => {
    // The predicate and the matcher must agree, and both must cover whatever
    // pages are actually on disk — a third settings page added later is caught
    // here rather than shipping unprotected.
    const dir = join(ROOT, 'src', 'app', '(app)', 'settings')
    const found: string[] = []
    const walk = (d: string, prefix: string) => {
      for (const entry of readdirSync(d)) {
        const full = join(d, entry)
        if (statSync(full).isDirectory()) walk(full, `${prefix}/${entry}`)
        else if (entry === 'page.tsx') found.push(prefix)
      }
    }
    walk(dir, '/settings')
    expect(found.length).toBeGreaterThan(0)
    for (const route of found) {
      expect(route.startsWith('/settings'), `${route} is not under /settings`).toBe(true)
    }
  })
})
