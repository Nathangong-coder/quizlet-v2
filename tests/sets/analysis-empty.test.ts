import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { diagnoseEmptyState, type DashboardCoverage } from '@/lib/metrics/coverage'

const ROOT = process.cwd()

function code(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
}

const coverage = (over: Partial<DashboardCoverage> = {}): DashboardCoverage => ({
  klpStates: 10,
  klpStatesClearingFloor: 5,
  cardsWithLiveKlps: 20,
  cardsWithLiveKlpsInScope: 20,
  categorizedCards: 15,
  topicCapableCards: 15,
  pendingExtraction: 0,
  pendingKltSummarization: 0,
  ...over,
})

/**
 * The set Analysis page must NAME why it is thin.
 *
 * An earlier draft shipped one hand-rolled "nothing to analyse yet" message for
 * every cause — the exact merge `diagnoseEmptyState` exists to prevent. Its own
 * doc records that the 3B live gate produced two of these causes and both read
 * as a broken feature until they were diagnosed against the database. The
 * remedies are genuinely different: extract key points, study this set, answer
 * more, lower your floor, add a category.
 */
describe('set analysis diagnoses its empty states', () => {
  it('routes through diagnoseEmptyState rather than a bespoke check', () => {
    const loader = code('src/lib/sets/knowledge.ts')
    expect(loader).toContain('diagnoseEmptyState')
    expect(loader).toContain('loadCoverage')
  })

  it('renders the diagnosis on the page', () => {
    const page = code('src/app/(app)/sets/[id]/(views)/analysis/page.tsx')
    expect(page).toContain('SetAnalysisEmpty')
  })

  it('does not reintroduce a single merged empty message', () => {
    // The specific regression. Comments are stripped above, so the prose
    // explaining this cannot satisfy the assertion.
    const page = code('src/app/(app)/sets/[id]/(views)/analysis/page.tsx')
    expect(page).not.toContain('Nothing to analyse on this set yet')
  })

  it('scopes the diagnosis to this set, not the whole library', () => {
    const loader = code('src/lib/sets/knowledge.ts')
    // `scoped: true` is what makes `scope_too_narrow` reachable and correct
    // here; passing false would silently reclassify it as `no_history`.
    expect(loader).toMatch(/diagnoseEmptyState\(coverage, true, floor\)/)
  })
})

/**
 * The five causes stay five. If `diagnoseEmptyState` ever collapses two, this
 * fails here as well as on the dashboard.
 */
describe('the five causes remain distinguishable', () => {
  it('names each one from its own coverage shape', () => {
    expect(diagnoseEmptyState(coverage({ cardsWithLiveKlps: 0 }), true, 3)?.kind).toBe('no_klps')
    expect(diagnoseEmptyState(coverage({ cardsWithLiveKlpsInScope: 0 }), true, 3)?.kind).toBe(
      'scope_too_narrow',
    )
    expect(diagnoseEmptyState(coverage({ klpStates: 0 }), true, 3)?.kind).toBe('no_history')
    expect(diagnoseEmptyState(coverage({ klpStatesClearingFloor: 0 }), true, 3)?.kind).toBe(
      'below_floor',
    )
    expect(diagnoseEmptyState(coverage({ topicCapableCards: 0 }), true, 3)?.kind).toBe(
      'nothing_categorized',
    )
    expect(diagnoseEmptyState(coverage(), true, 3)).toBeNull()
  })

  it('separates blocking causes from explanatory ones', () => {
    // A blocking cause replaces the panels; a non-blocking one sits above real
    // content and explains a gap in it. Collapsing the two would either hide
    // working panels or show empty ones with no reason given.
    expect(diagnoseEmptyState(coverage({ klpStates: 0 }), true, 3)?.blocking).toBe(true)
    expect(diagnoseEmptyState(coverage({ klpStatesClearingFloor: 0 }), true, 3)?.blocking).toBe(
      false,
    )
  })
})

/**
 * The copy is set-specific, deliberately not `EmptyDashboard`'s.
 */
describe('set-scoped copy replaces the dashboard advice that does not apply here', () => {
  const src = code('src/components/sets/knowledge/SetAnalysisEmpty.tsx')

  it('handles every cause kind', () => {
    for (const kind of [
      'no_klps',
      'scope_too_narrow',
      'no_history',
      'below_floor',
      'nothing_categorized',
    ]) {
      expect(src, `${kind} must have its own branch`).toContain(`'${kind}'`)
    }
  })

  it('never tells a reader to widen a scope they cannot widen', () => {
    // `EmptyDashboard`'s `scope_too_narrow` says "widen the scope" and links to
    // the settings page. On a set page the scope IS the set, reached by
    // navigating to it; that advice is nonsense here.
    expect(src).not.toContain('Widen the scope')
    expect(src).not.toContain('Change your study scope')
  })

  it('sends the evidence-floor remedy to the page that holds the control', () => {
    // The panel moved to /settings/study on 2026-08-28.
    expect(src).toContain("href: '/settings/study'")
    expect(src).not.toContain("href: '/settings/ai'")
  })
})
