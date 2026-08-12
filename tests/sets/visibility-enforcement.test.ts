import { describe, it, expect } from 'vitest'
import { readableSetWhere } from '@/lib/sets/visibility'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/**
 * Every read path that fetches a Set by client-supplied id.
 *
 * THIS LIST IS THE ENFORCEMENT CHECKLIST. A path missing from it is a path
 * nobody is checking — which is exactly how all ten original leaks happened.
 * If you add a route or action that reads a set by id, add it here.
 *
 * These assertions are deliberately source-level rather than behavioural. The
 * predicate itself is proven correct by tests/sets/visibility.test.ts; what
 * fails in practice is a CALL SITE that never invokes it, and that is a
 * property of the file, not of the function.
 */
const ENFORCED_PATHS = [
  'src/app/sets/[id]/page.tsx',
  'src/app/sets/[id]/match/page.tsx',
  'src/app/sets/[id]/quiz/page.tsx',
  'src/app/sets/[id]/review/page.tsx',
  'src/app/sets/[id]/print/page.tsx',
  'src/actions/quiz.ts',
  // Fetches a set TITLE for the profile block from a URL-controlled scope.
  // Only the title leaked, since its other reads are userId-scoped — but the
  // hole was the same shape, and an exception here would be the first crack in
  // a list whose whole value is having none.
  'src/lib/memory/profile.ts',
]

describe('every set read path applies readableSetWhere', () => {
  for (const path of ENFORCED_PATHS) {
    it(`${path} uses readableSetWhere`, () => {
      const src = readFileSync(join(ROOT, path), 'utf8')
      expect(src, `${path} must apply the predicate`).toContain('readableSetWhere')
    })

    it(`${path} has no unguarded prisma.set.findUnique`, () => {
      // `findUnique` accepts only unique fields, so `readableSetWhere` CANNOT
      // be spread into it — Prisma rejects a non-unique filter there. Every one
      // of these sites must therefore have moved to `findFirst`. A surviving
      // `prisma.set.findUnique` is proof the guard was not actually applied.
      const src = readFileSync(join(ROOT, path), 'utf8')
      expect(src).not.toMatch(/prisma\.set\.findUnique/)
    })
  }
})

describe('the fragment composes correctly with an id lookup', () => {
  it('ANDs with the id rather than replacing it', () => {
    // Typed as a bag because readableSetWhere returns Record<string, unknown>:
    // spreading an index signature does not surface known keys to TS.
    const where: Record<string, unknown> = { id: 'set1', ...readableSetWhere('u1') }
    expect(where.id).toBe('set1')
    expect(where.OR).toBeDefined()
  })

  it('documents that a naive spread clobbers an existing OR', () => {
    // Documents the hazard rather than permitting it. No call site above has
    // its own OR today; if one ever does, the two must be combined under an
    // explicit AND, never merged by spread.
    const naive: Record<string, unknown> = {
      OR: [{ title: 'x' }],
      ...readableSetWhere('u1'),
    }
    expect(naive.OR).toEqual(readableSetWhere('u1').OR)
  })
})
