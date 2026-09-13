import { describe, it, expect } from 'vitest'
import {
  SUBJECTS,
  SUBJECT_SLUGS,
  getSubject,
  getSubjectGroup,
  isSubjectSlug,
  expandSubjectFilter,
  subjectPath,
} from '@/lib/subjects/taxonomy'

describe('subject taxonomy', () => {
  it('has unique slugs across groups and leaves', () => {
    const all = [...SUBJECTS.map((g) => g.slug), ...SUBJECTS.flatMap((g) => g.leaves.map((l) => l.slug))]
    expect(new Set(all).size).toBe(all.length)
    for (const slug of all) expect(slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('gives every group at least three leaves', () => {
    for (const g of SUBJECTS) expect(g.leaves.length, g.slug).toBeGreaterThanOrEqual(3)
  })

  it('resolves a leaf with its group and rejects a group slug or a stranger', () => {
    expect(getSubject('accounting')).toEqual({
      slug: 'accounting',
      label: 'Accounting',
      group: { slug: 'business-finance', label: 'Business & Finance' },
    })
    expect(getSubject('business-finance')).toBeNull()
    expect(getSubject('nope')).toBeNull()
    expect(getSubject(null)).toBeNull()
    expect(isSubjectSlug('valuation')).toBe(true)
    expect(isSubjectSlug('science')).toBe(false)
    expect(getSubjectGroup('science')?.label).toBe('Science')
  })

  it('SUBJECT_SLUGS lists leaves only', () => {
    expect(SUBJECT_SLUGS).toContain('accounting')
    expect(SUBJECT_SLUGS).not.toContain('business-finance')
  })

  it('expands a filter: leaf → itself, group → its leaves, unknown → nothing', () => {
    expect(expandSubjectFilter('history')).toEqual(['history'])
    expect(expandSubjectFilter('maths')).toEqual(SUBJECTS.find((g) => g.slug === 'maths')!.leaves.map((l) => l.slug))
    // Nothing, not everything: an unknown ?subject= must show an empty page.
    expect(expandSubjectFilter('nope')).toEqual([])
    expect(expandSubjectFilter(undefined)).toEqual([])
  })

  it('renders a path for a chip', () => {
    expect(subjectPath('mergers-acquisitions')).toBe('Business & Finance · M&A')
    expect(subjectPath('nope')).toBeNull()
  })
})
