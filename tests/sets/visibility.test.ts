import { describe, it, expect } from 'vitest'
import {
  SET_VISIBILITIES, toSetVisibility, canReadSet, readableSetWhere,
} from '@/lib/sets/visibility'

const OWNER = 'user-owner'
const OTHER = 'user-other'

describe('SET_VISIBILITIES', () => {
  it('pins the vocabulary the Prisma column documents', () => {
    expect([...SET_VISIBILITIES]).toEqual(['private', 'link'])
  })
})

describe('toSetVisibility', () => {
  it('passes known values through', () => {
    for (const v of SET_VISIBILITIES) expect(toSetVisibility(v)).toBe(v)
  })

  it('FAILS CLOSED on an unrecognised value', () => {
    // Wrongly hiding a set annoys the owner; wrongly exposing one is the bug
    // this module exists to close. Unknown must never resolve to 'link'.
    expect(toSetVisibility('public')).toBe('private')
    expect(toSetVisibility('')).toBe('private')
    expect(toSetVisibility('Link')).toBe('private')
  })
})

describe('canReadSet', () => {
  const priv = { userId: OWNER, visibility: 'private' }
  const link = { userId: OWNER, visibility: 'link' }

  it('lets the owner read their own set in either state', () => {
    expect(canReadSet(priv, OWNER)).toBe(true)
    expect(canReadSet(link, OWNER)).toBe(true)
  })

  it('denies another signed-in user a private set', () => {
    expect(canReadSet(priv, OTHER)).toBe(false)
  })

  it('allows another signed-in user a link-shared set', () => {
    expect(canReadSet(link, OTHER)).toBe(true)
  })

  it('denies an anonymous viewer a private set', () => {
    expect(canReadSet(priv, null)).toBe(false)
  })

  it('allows an anonymous viewer a link-shared set', () => {
    // Signed-out viewing of a share link is a requirement, not an oversight.
    expect(canReadSet(link, null)).toBe(true)
  })

  it('treats an unrecognised stored visibility as private', () => {
    expect(canReadSet({ userId: OWNER, visibility: 'garbage' }, OTHER)).toBe(false)
    expect(canReadSet({ userId: OWNER, visibility: 'garbage' }, OWNER)).toBe(true)
  })

  it('does not match a NULL owner against an anonymous viewer', () => {
    // `null === null` is true, so without the explicit `viewerId !== null`
    // guard a set row whose userId came back null would be readable by every
    // anonymous visitor regardless of its visibility. The types say
    // `userId: string`, so this is defence against a malformed row rather than
    // an expected shape — but it is the ONLY case that exercises the guard,
    // and an unexercised guard is one a future edit deletes as dead code.
    //
    // Note `undefined` does NOT exercise it: `undefined === null` is false, so
    // a `select` that merely omits userId falls through to the visibility
    // check on its own.
    const malformed = { userId: null, visibility: 'private' } as unknown as {
      userId: string
      visibility: string
    }
    expect(canReadSet(malformed, null)).toBe(false)
  })
})

describe('readableSetWhere', () => {
  it('matches owned OR link-shared for a signed-in viewer', () => {
    expect(readableSetWhere(OWNER)).toEqual({
      OR: [{ userId: OWNER }, { visibility: 'link' }],
    })
  })

  it('matches only link-shared for an anonymous viewer', () => {
    // NOT `{ OR: [{ userId: null }, ...] }` — a null userId would match
    // nothing in Postgres and is a confusing way to express "no owner match".
    expect(readableSetWhere(null)).toEqual({ visibility: 'link' })
  })

  it('never returns an empty object', () => {
    // An empty fragment spread into a `where` is a no-op that matches EVERY
    // set — the exact failure this module exists to prevent.
    expect(Object.keys(readableSetWhere(OWNER)).length).toBeGreaterThan(0)
    expect(Object.keys(readableSetWhere(null)).length).toBeGreaterThan(0)
  })

  it('agrees with canReadSet on every combination', () => {
    // The two must not drift: the fragment guards queries, the predicate
    // guards rows already in hand, and a disagreement is a silent hole.
    for (const viewer of [OWNER, OTHER, null]) {
      for (const visibility of SET_VISIBILITIES) {
        const set = { userId: OWNER, visibility }
        const frag = readableSetWhere(viewer)
        const matchesByFragment =
          'OR' in frag
            ? (frag.OR as { userId?: string; visibility?: string }[]).some(
                (c) => c.userId === set.userId || c.visibility === set.visibility,
              )
            : (frag as { visibility: string }).visibility === set.visibility
        expect(matchesByFragment, `${viewer}/${visibility}`).toBe(canReadSet(set, viewer))
      }
    }
  })
})
