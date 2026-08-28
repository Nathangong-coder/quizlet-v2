import { describe, it, expect } from 'vitest'
import { buildDirectoryWhere, DIRECTORY_PAGE_SIZE } from '@/lib/sets/directory'
import { readableSetWhere, listableSetWhere } from '@/lib/sets/visibility'

const VIEWER = 'u1'

describe('buildDirectoryWhere', () => {
  it('composes readable AND listable under an explicit AND', () => {
    expect(buildDirectoryWhere(VIEWER)).toEqual({
      AND: [readableSetWhere(VIEWER), listableSetWhere()],
    })
  })

  it('adds the search OR as a THIRD AND member, never by spreading', () => {
    // THE assertion for spec §3.1. Spreading a search OR into a where that
    // already carries readableSetWhere's OR replaces it, widening the
    // directory to every set in the database — and it returns plausible
    // results while doing it, so the page looks fine.
    const where = buildDirectoryWhere(VIEWER, 'merger') as {
      AND: Record<string, unknown>[]
    }
    expect(where.AND).toHaveLength(3)
    expect(where.AND.filter((c) => 'OR' in c)).toHaveLength(2)
  })

  it('searches title and description, case-insensitively', () => {
    const where = buildDirectoryWhere(null, 'merger') as { AND: Record<string, unknown>[] }
    const search = where.AND.find(
      (c) => 'OR' in c && JSON.stringify(c).includes('title'),
    ) as { OR: Record<string, unknown>[] }
    expect(search.OR).toEqual([
      { title: { contains: 'merger', mode: 'insensitive' } },
      { description: { contains: 'merger', mode: 'insensitive' } },
    ])
  })

  it('omits the search clause entirely for a blank query', () => {
    // `{ contains: '' }` matches every row, which is not the same thing as
    // "no filter" once it is sitting inside an OR alongside other clauses.
    for (const q of [undefined, '', '   ']) {
      const where = buildDirectoryWhere(VIEWER, q) as { AND: unknown[] }
      expect(where.AND, String(q)).toHaveLength(2)
    }
  })

  it('never omits the readable fragment, even though listable implies public', () => {
    // Not redundant: the day someone adds "also show my own private sets
    // here", a hand-rolled filter leaks and a composed one does not.
    const where = buildDirectoryWhere(null) as { AND: Record<string, unknown>[] }
    expect(where.AND).toContainEqual(readableSetWhere(null))
  })

  it('excludes unlisted sets', () => {
    const where = buildDirectoryWhere(VIEWER) as { AND: Record<string, unknown>[] }
    expect(where.AND).toContainEqual({ visibility: 'public', listingBlocked: false })
  })
})

describe('DIRECTORY_PAGE_SIZE', () => {
  it('is a bounded page', () => {
    expect(DIRECTORY_PAGE_SIZE).toBeGreaterThan(0)
    expect(DIRECTORY_PAGE_SIZE).toBeLessThanOrEqual(50)
  })
})
