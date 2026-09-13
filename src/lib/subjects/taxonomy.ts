/**
 * The subject taxonomy: a FIXED two-level tree, in code.
 *
 * A set's subject is the axis Browse and the Library filter on, so it has to
 * mean the same thing for every user — which is why it is not user-defined.
 * The user-defined axis already exists: per-card categories, set-scoped and
 * coloured, and they answer a different question ("which of MY cards are
 * talking points") than this one ("is this an accounting set").
 *
 * A set stores ONE LEAF slug in `Set.subject` (nullable — nothing forces a
 * subject). The parent is derived here, never stored, so a leaf can be moved
 * under a different parent by editing this file and nothing in the database
 * goes stale. Slugs are persisted, so RENAMING A SLUG STRANDS EVERY SET THAT
 * CARRIES IT — add a new leaf and migrate rows instead. Labels are free to
 * change.
 *
 * Client-importable: no Prisma, no server-only modules.
 */

export interface SubjectLeaf {
  slug: string
  label: string
}

export interface SubjectGroup {
  slug: string
  label: string
  leaves: readonly SubjectLeaf[]
}

export const SUBJECTS: readonly SubjectGroup[] = [
  {
    slug: 'business-finance',
    label: 'Business & Finance',
    leaves: [
      { slug: 'accounting', label: 'Accounting' },
      { slug: 'valuation', label: 'Valuation' },
      { slug: 'mergers-acquisitions', label: 'M&A' },
      { slug: 'lbo-private-equity', label: 'LBO & Private equity' },
      { slug: 'corporate-finance', label: 'Corporate finance' },
      { slug: 'markets-trading', label: 'Markets & Trading' },
      { slug: 'economics', label: 'Economics' },
      { slug: 'management-strategy', label: 'Management & Strategy' },
    ],
  },
  {
    slug: 'science',
    label: 'Science',
    leaves: [
      { slug: 'biology', label: 'Biology' },
      { slug: 'chemistry', label: 'Chemistry' },
      { slug: 'physics', label: 'Physics' },
      { slug: 'earth-space', label: 'Earth & Space' },
      { slug: 'environmental-science', label: 'Environmental science' },
    ],
  },
  {
    slug: 'maths',
    label: 'Maths',
    leaves: [
      { slug: 'arithmetic-algebra', label: 'Arithmetic & Algebra' },
      { slug: 'geometry-trigonometry', label: 'Geometry & Trigonometry' },
      { slug: 'calculus', label: 'Calculus' },
      { slug: 'statistics-probability', label: 'Statistics & Probability' },
    ],
  },
  {
    slug: 'languages',
    label: 'Languages',
    leaves: [
      { slug: 'english', label: 'English' },
      { slug: 'spanish', label: 'Spanish' },
      { slug: 'french', label: 'French' },
      { slug: 'german', label: 'German' },
      { slug: 'chinese', label: 'Chinese' },
      { slug: 'japanese', label: 'Japanese' },
      { slug: 'latin', label: 'Latin' },
      { slug: 'other-language', label: 'Other language' },
    ],
  },
  {
    slug: 'arts-humanities',
    label: 'Arts & Humanities',
    leaves: [
      { slug: 'history', label: 'History' },
      { slug: 'literature', label: 'Literature' },
      { slug: 'philosophy', label: 'Philosophy' },
      { slug: 'religion', label: 'Religion' },
      { slug: 'art-music', label: 'Art & Music' },
    ],
  },
  {
    slug: 'social-science',
    label: 'Social Science',
    leaves: [
      { slug: 'psychology', label: 'Psychology' },
      { slug: 'sociology', label: 'Sociology' },
      { slug: 'political-science', label: 'Political science' },
      { slug: 'law', label: 'Law' },
      { slug: 'geography', label: 'Geography' },
    ],
  },
  {
    slug: 'medicine-health',
    label: 'Medicine & Health',
    leaves: [
      { slug: 'anatomy-physiology', label: 'Anatomy & Physiology' },
      { slug: 'pharmacology', label: 'Pharmacology' },
      { slug: 'nursing', label: 'Nursing' },
      { slug: 'medical-terminology', label: 'Medical terminology' },
    ],
  },
  {
    slug: 'technology',
    label: 'Technology',
    leaves: [
      { slug: 'programming', label: 'Programming' },
      { slug: 'computer-science', label: 'Computer science' },
      { slug: 'data-science', label: 'Data science' },
      { slug: 'engineering', label: 'Engineering' },
    ],
  },
  {
    slug: 'other',
    label: 'Other',
    leaves: [
      { slug: 'exam-prep', label: 'Exam prep' },
      { slug: 'professional-certification', label: 'Professional certification' },
      { slug: 'general-knowledge', label: 'General knowledge' },
    ],
  },
]

export interface ResolvedSubject {
  slug: string
  label: string
  group: { slug: string; label: string }
}

const BY_LEAF: ReadonlyMap<string, ResolvedSubject> = new Map(
  SUBJECTS.flatMap((g) => g.leaves.map((l) => [l.slug, { slug: l.slug, label: l.label, group: { slug: g.slug, label: g.label } }] as const)),
)

const BY_GROUP: ReadonlyMap<string, SubjectGroup> = new Map(SUBJECTS.map((g) => [g.slug, g]))

export const SUBJECT_SLUGS: readonly string[] = [...BY_LEAF.keys()]

/** A leaf with its group, or null. Never throws — a persisted slug may be gone. */
export function getSubject(slug: string | null | undefined): ResolvedSubject | null {
  if (!slug) return null
  return BY_LEAF.get(slug) ?? null
}

export function getSubjectGroup(slug: string | null | undefined): SubjectGroup | null {
  if (!slug) return null
  return BY_GROUP.get(slug) ?? null
}

export function isSubjectSlug(slug: string): boolean {
  return BY_LEAF.has(slug)
}

/**
 * The leaf slugs a filter value covers: a leaf covers itself, a group covers
 * every leaf under it, and anything else covers nothing (so an unknown
 * `?subject=` shows an empty result rather than everything).
 */
export function expandSubjectFilter(slug: string | null | undefined): readonly string[] {
  if (!slug) return []
  if (BY_LEAF.has(slug)) return [slug]
  const group = BY_GROUP.get(slug)
  return group ? group.leaves.map((l) => l.slug) : []
}

/** "Business & Finance · Accounting" — for a chip or a page title. */
export function subjectPath(slug: string | null | undefined): string | null {
  const s = getSubject(slug)
  return s ? `${s.group.label} · ${s.label}` : null
}
