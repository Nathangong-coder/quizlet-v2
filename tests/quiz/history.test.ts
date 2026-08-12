import { describe, it, expect } from 'vitest'
import { ANSWERED_ATTEMPT_WHERE } from '@/lib/quiz/history'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()

/**
 * The two — and only two — call sites allowed to apply the predicate.
 *
 * Both are read-only history surfaces: nothing in flight passes through them.
 */
const ALLOWED_CALL_SITES = ['src/actions/user.ts', 'src/lib/metrics/read.ts']

/**
 * Readers that must NEVER filter, called out by name so a violation names
 * itself instead of surfacing as a mysteriously broken quiz.
 *
 * These are listed for documentation value; the exhaustive scan below is what
 * actually enforces the rule, since the dangerous case is a site nobody
 * thought to enumerate.
 */
const MUST_NEVER_FILTER = [
  'src/actions/quiz.ts',
  'src/actions/quiz-matching.ts',
  'src/app/sets/[id]/print/page.tsx',
  'src/lib/memory/erase-execute.ts',
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('ANSWERED_ATTEMPT_WHERE', () => {
  it('is the zero-answer exclusion, and nothing else', () => {
    // `some: {}` — "at least one answer, any answer". Not `_count`, which
    // Prisma cannot filter on in a `where`, and not `NOT: { answers: { none: {} } }`,
    // which is the same set expressed so a reader must double-negate it.
    expect(ANSWERED_ATTEMPT_WHERE).toEqual({ answers: { some: {} } })
  })

  it('spreads alongside a userId scope without replacing it', () => {
    // Both call sites spread it into an existing `where: { userId }`. The keys
    // are disjoint, so this is safe — asserted rather than assumed, because a
    // predicate that silently dropped the owner scope would turn a display bug
    // into a cross-user data leak.
    const where = { userId: 'u1', ...ANSWERED_ATTEMPT_WHERE }
    expect(where.userId).toBe('u1')
    expect(where.answers).toEqual({ some: {} })
  })
})

/**
 * The over-application guard.
 *
 * THE RISK HERE IS INVERTED FROM `readableSetWhere`. That predicate could not
 * be spread too widely — a missing one leaked data, an extra one cost nothing,
 * so its test asserts a list of paths that MUST contain it. This one is the
 * mirror image: an in-flight `QuizAttempt` has zero answers until the first
 * submit, so an extra application takes quizzing down, while a missing one only
 * shows a husk row on /profile.
 *
 * So the assertion is exhaustive in the other direction: scan all of `src/` and
 * require the set of referencing files to be exactly the definition plus the
 * two sanctioned readers. A behavioural test cannot catch this — the damage is
 * done by a call site in a file no test yet renders.
 */
describe('the predicate is applied at exactly two call sites', () => {
  const referencing = sourceFiles(join(ROOT, 'src'))
    .filter((f) => readFileSync(f, 'utf8').includes('ANSWERED_ATTEMPT_WHERE'))
    .map((f) => relative(ROOT, f).split(sep).join('/'))
    .sort()

  it('is referenced only by its definition and the two history readers', () => {
    expect(referencing).toEqual(
      ['src/lib/quiz/history.ts', ...ALLOWED_CALL_SITES].sort(),
    )
  })

  for (const path of ALLOWED_CALL_SITES) {
    it(`${path} actually applies it`, () => {
      expect(referencing).toContain(path)
    })
  }

  for (const path of MUST_NEVER_FILTER) {
    it(`${path} never applies it`, () => {
      // Named individually so the failure message says WHICH in-flight reader
      // was broken. `src/actions/quiz.ts` filtered here breaks the first
      // question of every quiz; `print/page.tsx` filtered here breaks printable
      // attempts, which are zero-answer by design.
      expect(referencing).not.toContain(path)
    })
  }
})
