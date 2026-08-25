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

  it('warns when the vocabulary looks fragmented instead of failing silently', () => {
    // Near-one-topic-per-card is the §9.4 failure mode, and it is invisible
    // unless something says so.
    expect(script).toMatch(/fragmenting/)
  })

  it('is registered as an npm script', () => {
    expect(pkg.scripts['backfill:klts']).toContain('scripts/backfill-klts.ts')
  })
})
