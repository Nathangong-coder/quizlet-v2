import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const script = readFileSync(join(process.cwd(), 'scripts/backfill-klts.ts'), 'utf8')
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))

describe('backfill-klts', () => {
  it('skips cards already summarized, so a re-run resumes rather than redoes', () => {
    expect(script).toMatch(/kltStatus:\s*\{\s*not:\s*'ready'\s*\}/)
  })

  it('only touches cards that actually have live KLPs', () => {
    expect(script).toMatch(/supersededAt:\s*null/)
  })

  it('scopes every card read to one owner — summarization bills their keys', () => {
    expect(script).toMatch(/set:\s*\{\s*userId:\s*owner\.id\s*\}/)
  })

  it('wraps its body in main() — top-level await breaks under CJS output', () => {
    expect(script).toMatch(/async function main\(\)/)
    expect(script).not.toMatch(/^await /m)
  })

  it('runs placement after summarization', () => {
    expect(script).toMatch(/placeUnparentedConcepts/)
    expect(script.indexOf('summarizeKltsForCards')).toBeLessThan(
      script.indexOf('placeUnparentedConcepts'),
    )
  })

  it('guards placement against an empty owners table', () => {
    // R4: `owners[0]?.id ?? ''` would still reach `placeUnparentedConcepts` ->
    // `generateJson` with an empty userId and fail credential resolution in a
    // confusing way, instead of skipping cleanly like every other
    // empty-database path in this script.
    expect(script).not.toMatch(/owners\[0\]\?\.id\s*\?\?\s*''/)
    expect(script).toMatch(/owners\.length > 0/)
  })

  it('checks structural invariants and reports violations loudly', () => {
    expect(script).toMatch(/checkTreeInvariants/)
    expect(script).toMatch(/STRUCTURAL VIOLATIONS/)
  })

  it('warns on overloaded nodes — the signal a rung is missing', () => {
    expect(script).toMatch(/MAX_BRANCHING/)
  })

  it('warns on leaf proliferation', () => {
    expect(script).toMatch(/single key point/)
  })

  it('is registered as an npm script', () => {
    expect(pkg.scripts['backfill:klts']).toContain('scripts/backfill-klts.ts')
  })
})
