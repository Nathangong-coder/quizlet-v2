import { describe, it, expect } from 'vitest'
import {
  SET_VISIBILITIES, READABLE_VISIBILITIES, toSetVisibility, canReadSet,
  readableSetWhere, listableSetWhere, composeSetWhere,
} from '@/lib/sets/visibility'

const OWNER = 'user-owner'
const OTHER = 'user-other'

describe('SET_VISIBILITIES', () => {
  it('pins the vocabulary the Prisma column documents', () => {
    expect([...SET_VISIBILITIES]).toEqual(['private', 'link', 'public'])
  })

  it('READABLE_VISIBILITIES is exactly the non-private members', () => {
    // Drift here is a silent hole: a value in SET_VISIBILITIES but not in
    // READABLE_VISIBILITIES is unreadable by anyone but its owner, and the
    // reverse makes `private` readable.
    expect([...READABLE_VISIBILITIES]).toEqual(
      SET_VISIBILITIES.filter((v) => v !== 'private'),
    )
  })
})

describe('toSetVisibility', () => {
  it('passes known values through', () => {
    for (const v of SET_VISIBILITIES) expect(toSetVisibility(v)).toBe(v)
  })

  it('FAILS CLOSED on an unrecognised value', () => {
    expect(toSetVisibility('')).toBe('private')
    expect(toSetVisibility('Link')).toBe('private')
    expect(toSetVisibility('garbage')).toBe('private')
  })

  it('NEVER degrades to public', () => {
    // The specific assertion spec §3 demands. `public` is the widest state in
    // the system; reaching it by accident is the worst outcome this module
    // has. Note this replaces an older test that asserted
    // toSetVisibility('public') === 'private' — which was correct when
    // `public` was not a member and is wrong now.
    for (const raw of ['', 'Public', 'PUBLIC', 'garbage', 'pubic', 'link ']) {
      expect(toSetVisibility(raw), raw).not.toBe('public')
    }
  })
})

describe('canReadSet', () => {
  const priv = { userId: OWNER, visibility: 'private' }
  const link = { userId: OWNER, visibility: 'link' }
  const pub = { userId: OWNER, visibility: 'public' }

  it('lets the owner read their own set in every state', () => {
    for (const s of [priv, link, pub]) expect(canReadSet(s, OWNER)).toBe(true)
  })

  it('denies another signed-in user a private set', () => {
    expect(canReadSet(priv, OTHER)).toBe(false)
  })

  it('allows another signed-in user a link-shared or public set', () => {
    expect(canReadSet(link, OTHER)).toBe(true)
    expect(canReadSet(pub, OTHER)).toBe(true)
  })

  it('denies an anonymous viewer a private set', () => {
    expect(canReadSet(priv, null)).toBe(false)
  })

  it('allows an anonymous viewer a link-shared or public set', () => {
    expect(canReadSet(link, null)).toBe(true)
    // Without this, every public set renders its media as a broken
    // placeholder: /api/assets/[id] decides through canReadSet.
    expect(canReadSet(pub, null)).toBe(true)
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
    const malformed = { userId: null, visibility: 'private' } as unknown as {
      userId: string
      visibility: string
    }
    expect(canReadSet(malformed, null)).toBe(false)
  })
})

describe('readableSetWhere', () => {
  it('matches owned OR readable-visibility for a signed-in viewer', () => {
    expect(readableSetWhere(OWNER)).toEqual({
      OR: [{ userId: OWNER }, { visibility: { in: READABLE_VISIBILITIES } }],
    })
  })

  it('uses `in`, NOT a second OR, for an anonymous viewer', () => {
    // Spec §3.1. The naive extension would return
    // `{ OR: [{visibility:'link'}, {visibility:'public'}] }`, which turns the
    // signed-out branch into an OR too — so spreading it into the directory's
    // where (which has its own search OR) would REPLACE one of them and widen
    // the query to every set in the database, silently, while still returning
    // plausible results.
    const frag = readableSetWhere(null)
    expect(frag).toEqual({ visibility: { in: READABLE_VISIBILITIES } })
    expect(frag).not.toHaveProperty('OR')
  })

  it('has exactly one OR for a signed-in viewer and none for anonymous', () => {
    expect(Object.keys(readableSetWhere(OWNER))).toEqual(['OR'])
    expect(Object.keys(readableSetWhere(null))).toEqual(['visibility'])
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
        const frag = readableSetWhere(viewer) as {
          OR?: { userId?: string; visibility?: { in: readonly string[] } }[]
          visibility?: { in: readonly string[] }
        }
        const matchesByFragment = frag.OR
          ? frag.OR.some(
              (c) =>
                c.userId === set.userId ||
                (c.visibility?.in.includes(set.visibility) ?? false),
            )
          : (frag.visibility?.in.includes(set.visibility) ?? false)
        expect(matchesByFragment, `${viewer}/${visibility}`).toBe(canReadSet(set, viewer))
      }
    }
  })
})

describe('listableSetWhere', () => {
  it('lists only public, unblocked sets', () => {
    expect(listableSetWhere()).toEqual({ visibility: 'public', listingBlocked: false })
  })

  it('excludes link-shared sets from listing', () => {
    // link and public are NOT collapsed: they answer "may this be read?" and
    // "should this be advertised?". A learner who shared a study-group link
    // did not thereby ask to be published.
    expect(listableSetWhere()).not.toMatchObject({ visibility: 'link' })
  })
})

describe('composeSetWhere', () => {
  it('ANDs the readable fragment with every clause', () => {
    const search = { OR: [{ title: { contains: 'x' } }] }
    expect(composeSetWhere(OWNER, listableSetWhere(), search)).toEqual({
      AND: [readableSetWhere(OWNER), listableSetWhere(), search],
    })
  })

  it('keeps BOTH ORs alive rather than one replacing the other', () => {
    // THE test for spec §3.1's defect. Spreading readableSetWhere(OWNER) and a
    // search OR into one object leaves exactly one OR key; composing must
    // leave two, in separate AND members.
    const search = { OR: [{ title: { contains: 'x' } }] }
    const composed = composeSetWhere(OWNER, search) as { AND: Record<string, unknown>[] }
    const orCount = composed.AND.filter((c) => 'OR' in c).length
    expect(orCount).toBe(2)

    const spreadInstead = { ...readableSetWhere(OWNER), ...search }
    expect(Object.keys(spreadInstead).filter((k) => k === 'OR')).toHaveLength(1)
  })

  it('never produces an empty AND', () => {
    const composed = composeSetWhere(null) as { AND: Record<string, unknown>[] }
    expect(composed.AND.length).toBeGreaterThan(0)
  })
})
