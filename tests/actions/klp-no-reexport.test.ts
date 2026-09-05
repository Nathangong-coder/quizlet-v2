import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Narrow regression guard for the invariant Task 7 established (moving
 * `writeKlpVersion` out of `src/actions/klp.ts`, a `'use server'` module):
 * every export of a file-level `'use server'` module is a callable RPC
 * endpoint, so re-exporting `writeKlpVersion` from here would restore an
 * unauthenticated structural write into any card — no session or ownership
 * check, straight into `CardKlp`.
 *
 * `tests/actions/klt-gated-exports-guard.test.ts`'s FILES list does not
 * cover this file (its five exports gate with inline `auth()` rather than
 * the patterns that guard recognises, so adding it there is not a drop-in —
 * flagged for the final review as a broader structural gap). This test
 * closes the SPECIFIC invariant Task 7 just fixed, cheaply, so it cannot
 * silently regress in the meantime.
 */
describe('src/actions/klp.ts does not re-export writeKlpVersion', () => {
  const text = readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'actions', 'klp.ts'),
    'utf8',
  )

  it('contains no named re-export statement', () => {
    expect(text).not.toMatch(/export\s*\{[^}]*\}\s*from/)
  })

  it('does not export writeKlpVersion by name', () => {
    expect(text).not.toMatch(/export\s*\{[^}]*\bwriteKlpVersion\b[^}]*\}/)
  })
})
