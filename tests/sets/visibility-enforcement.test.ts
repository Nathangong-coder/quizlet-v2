import { describe, it, expect } from 'vitest'
import { readableSetWhere } from '@/lib/sets/visibility'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/**
 * Source with comments stripped.
 *
 * EVERY assertion in this file must run against this, never against the raw
 * file. These modules DOCUMENT the predicate at length — `directory.ts`'s doc
 * comment names both `readableSetWhere` and `composeSetWhere` in prose — so a
 * raw `includes()` passes on the explanation while the code does something
 * else entirely.
 *
 * Found 2026-08-27 by mutation testing: deleting `composeSetWhere` from
 * `directory.ts`'s actual query left this suite fully GREEN, because the words
 * survived in the comment above it. A guard that cannot fail is worse than no
 * guard, and this is the second time that specific shape has appeared here.
 */
function code(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
}

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
  'src/app/(app)/sets/[id]/(views)/page.tsx',
  'src/app/(app)/sets/[id]/(views)/layout.tsx',
  'src/app/(app)/sets/[id]/(views)/knowledge/page.tsx',
  'src/app/(app)/sets/[id]/(views)/analysis/page.tsx',
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
  // --- Added with public sets & discovery, 2026-08-27 ---
  // The homepage reads sets by id in two places — recents and recommendations
  // — and both are reachable by anyone with an account.
  'src/app/(app)/page.tsx',
  'src/app/(app)/browse/page.tsx',
  // Fork READS the source. It needs no write access to it and must never be
  // given any, so the read guard is the only guard it has.
  'src/actions/sets-fork.ts',
  'src/lib/sets/recents.ts',
  'src/lib/sets/directory.ts',
  'src/lib/sets/recommend.ts',
  'src/actions/set-reports.ts',
]

describe('every set read path applies readableSetWhere', () => {
  for (const path of ENFORCED_PATHS) {
    it(`${path} uses readableSetWhere`, () => {
      const src = code(path)
      // `composeSetWhere` counts: it IS `readableSetWhere` plus an explicit
      // AND, and it is the REQUIRED form for any read carrying a predicate of
      // its own. Accepting only the bare name would push those call sites
      // toward the spread this whole module exists to prevent.
      expect(
        src.includes('readableSetWhere') || src.includes('composeSetWhere'),
        `${path} must apply the predicate`,
      ).toBe(true)
    })

    it(`${path} has no unguarded prisma.set.findUnique`, () => {
      // `findUnique` accepts only unique fields, so `readableSetWhere` CANNOT
      // be spread into it — Prisma rejects a non-unique filter there. Every one
      // of these sites must therefore have moved to `findFirst`. A surviving
      // `prisma.set.findUnique` is proof the guard was not actually applied.
      const src = code(path)
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


describe('discovery reads compose rather than spread', () => {
  // The failure this catches returns PLAUSIBLE results — a directory widened
  // to every set in the database still renders a page full of sets. It cannot
  // be caught by looking at the screen, only by looking at the shape.
  const COMPOSING_PATHS = [
    'src/lib/sets/directory.ts',
    'src/lib/sets/recommend.ts',
    'src/actions/set-reports.ts',
  ]

  for (const path of COMPOSING_PATHS) {
    it(`${path} never spreads readableSetWhere alongside its own predicate`, () => {
      const src = code(path)
      // Two separate checks rather than one multiline regex. The hazard is
      // spreading the fragment into an object that ALSO carries an `OR` — the
      // second silently replaces the first. A file that spreads at all and has
      // a bare top-level `OR:` is the shape to reject; composing produces
      // neither.
      const spreads = /\.\.\.readableSetWhere\(/.test(src)
      const hasOwnOr = /^\s{0,6}OR: \[/m.test(src)
      expect(
        spreads && hasOwnOr,
        `${path} spreads readableSetWhere next to its own OR — compose under an explicit AND instead`,
      ).toBe(false)
    })
  }
})

describe('recommendations never write', () => {
  it('src/lib/sets/recommend.ts contains no Prisma write', () => {
    // "Recommended" is a recommendation surface, not evidence. A cross-user
    // category match is a string match wearing a concept's clothing, and the
    // roadmap's standing rule is that a bad cluster silently corrupts every
    // metric downstream of it. Source-level, because what fails in practice is
    // a call site somebody adds later, not a function.
    const src = readFileSync(join(ROOT, 'src/lib/sets/recommend.ts'), 'utf8')
    expect(src).not.toMatch(/prisma\.[a-zA-Z]+\.(create|update|upsert|delete)/)
  })
})

describe('forks are never born public', () => {
  it('src/actions/sets-fork.ts pins visibility to private', () => {
    // Inheriting the source's visibility would republish someone else's work
    // under a new name with no deliberate act.
    const src = code('src/actions/sets-fork.ts')
    expect(src).toMatch(/visibility: 'private'/)
    expect(src).not.toMatch(/visibility: (source|src)\.visibility/)
  })

  it('src/actions/sets-fork.ts copies blobs as private, never public', () => {
    // A public blob is fetchable by URL with NO authentication, routing every
    // forked asset around /api/assets/[id] — the proxy that owner-checks each
    // byte. The behavioural test in tests/actions/fork.test.ts is the primary
    // guard; this is the cheap source-level backstop, because the mock that
    // test relies on silently ignored `access` until 2026-08-27.
    //
    // `code()` rather than raw source, as everywhere else in this file: this
    // assertion is a NEGATIVE one, so a future comment here explaining why
    // `access: 'public'` would be wrong would make the guard fail for the wrong
    // reason — and the mirror-image assertion below would silently pass.
    const src = code('src/actions/sets-fork.ts')
    expect(src).toMatch(/access: 'private'/)
    expect(src).not.toMatch(/access: 'public'/)
  })
})

/**
 * EVERY WRITE TO THE STORE IS PRIVATE — and the two call sites still reach that
 * answer for different reasons, which is why both are asserted.
 *
 * A card asset is private CONTENT: it belongs to one owner and is proxied
 * through `/api/assets/[id]` so every byte is owner-checked.
 *
 * An avatar is not private at all — it sits beside a published set and is seen
 * by strangers — and until 2026-08-28 it was written `access: 'public'` on
 * exactly that reasoning. The reasoning was sound and the code was broken: the
 * Blob STORE backing this project is configured private, and the API rejects a
 * public write to it outright ("Cannot use public access on a private store"),
 * so every photo upload failed. It is private now for a mechanical reason, not
 * a privacy one, and `/api/avatar/[id]` puts the bytes back on a plain <img>.
 *
 * The fork assertion above is the one that still guards a SECURITY boundary
 * (public fork copies would route around the owner check — the bug actually
 * written on 2026-08-27). This one guards an OUTAGE: restoring `access:
 * 'public'` here on the old reasoning breaks uploads again, in a path no mock
 * can see, because a mocked store has no access mode to reject anything.
 */
describe('every blob write is private, for two different reasons', () => {
  it('avatars are private, and are served through their own proxy route', () => {
    const src = code('src/actions/avatar.ts')
    expect(src).toMatch(/access: 'private'/)
    expect(src).not.toMatch(/access: 'public'/)
    // The proxy is half of the fix, not an optional extra: a private blob URL
    // is not fetchable from a browser, so making the write private WITHOUT
    // this route swaps a failing upload for a broken image everywhere.
    expect(existsSync(join(ROOT, 'src/app/api/avatar/[id]/route.ts'))).toBe(true)
  })

  it('card asset uploads stay private', () => {
    const src = code('src/lib/uploads/index.ts')
    expect(src).toMatch(/access: "private"|access: 'private'/)
    expect(src).not.toMatch(/access: "public"|access: 'public'/)
  })

  it('the avatar action never accepts a caller-supplied user id', () => {
    // Every export in a `'use server'` file is a public endpoint. An id read
    // from the payload would let anyone overwrite anyone's picture.
    const src = code('src/actions/avatar.ts')
    expect(src).toMatch(/session\?\.user\?\.id/)
    expect(src).not.toMatch(/userId: input|userId: formData\.get/)
  })
})
