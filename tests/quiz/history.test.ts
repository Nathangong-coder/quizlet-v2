import { describe, it, expect } from 'vitest'
import { ANSWERED_ATTEMPT_WHERE } from '@/lib/quiz/history'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()

/**
 * The only call sites allowed to apply the predicate directly.
 *
 * Both are read-only history surfaces: nothing in flight passes through them.
 *
 * `src/lib/metrics/read.ts` USED to be here and now reaches the predicate
 * through `loadAnsweredAttemptIds` instead, which Spec 3B added so the quiz
 * results screen could share the identical attempt window. The results screen
 * lives in `src/actions/quiz.ts`, which must never contain the predicate —
 * its in-flight lookups would break — so the query moved to the one file that
 * is allowed to hold it rather than the guard being loosened to admit quiz.ts.
 * `HELPER_CALL_SITES` below keeps the coverage the move would otherwise lose.
 */
const ALLOWED_CALL_SITES = ['src/actions/user.ts']

/**
 * The files that must reach the predicate through `loadAnsweredAttemptIds`.
 *
 * Asserted because dropping `read.ts` from `ALLOWED_CALL_SITES` above would
 * otherwise silently stop checking that it filters at all — the guard would
 * still pass if the repeatBonus window went back to counting abandoned
 * attempts.
 */
const HELPER_CALL_SITES = ['src/actions/quiz.ts', 'src/lib/metrics/read.ts']

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
/**
 * Comments are stripped before scanning, so this detects USE rather than
 * mention. `QuizContainer.tsx` names the predicate in prose — explaining that a
 * failed discard is survivable precisely because history hides the leftover
 * attempt — and that cross-reference is worth keeping; a guard that forced
 * comments to avoid naming the thing they describe would be buying its
 * precision with worse documentation.
 *
 * Deliberately conservative: only WHOLE-LINE `//` comments and block comments
 * go. A trailing `// ... ANSWERED_ATTEMPT_WHERE ...` still trips the guard.
 * That is a false positive, but it fails loudly in the safe direction, whereas
 * a greedier regex could eat a real call site sharing a line with a string
 * containing `//` and fail silently in the dangerous one.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the predicate is applied at exactly two call sites', () => {
  const referencing = sourceFiles(join(ROOT, 'src'))
    .filter((f) => codeOnly(readFileSync(f, 'utf8')).includes('ANSWERED_ATTEMPT_WHERE'))
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

  // The trailing `(` matters: it detects a CALL, not an import. Matching the
  // bare name passes on a file that still imports the helper while querying
  // around it — which is precisely the regression this assertion exists for,
  // and it survived a mutation test written the other way.
  const usingHelper = sourceFiles(join(ROOT, 'src'))
    .filter((f) => codeOnly(readFileSync(f, 'utf8')).includes('loadAnsweredAttemptIds('))
    .map((f) => relative(ROOT, f).split(sep).join('/'))
    .sort()

  it('the shared attempt-window helper is used by exactly the two derivation surfaces', () => {
    // Both derive `repeatBonus`, which is positional, so they must draw the
    // attempt sequence from the same filtered population or the same tag
    // scores differently on the dashboard and on the results screen.
    expect(usingHelper).toEqual(['src/lib/quiz/history.ts', ...HELPER_CALL_SITES].sort())
  })

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
