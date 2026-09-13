import Link from 'next/link'
import { cn } from '@/lib/utils'
import { SUBJECTS, getSubject, getSubjectGroup } from '@/lib/subjects/taxonomy'

/**
 * Two rows of links: the top-level subjects, and — once one is chosen — its
 * leaves. Server-rendered, URL-driven (`?subject=`), no client state: the
 * filter IS the address, so a filtered Browse can be linked to and comes
 * back on reload.
 *
 * `current` may be a group slug (whole group), a leaf slug (that leaf, with
 * its group shown as chosen), or nothing.
 */
export function SubjectFilterBar({
  current,
  basePath,
  otherParams = {},
  counts,
}: {
  current: string | undefined
  basePath: string
  /** Query params to carry across, e.g. `{ q }` on Browse or `{ type, sort }` in the Library. */
  otherParams?: Record<string, string | undefined>
  /** Optional per-slug counts (groups and leaves); a slug with count 0 is hidden. */
  counts?: Record<string, number>
}) {
  const leaf = getSubject(current)
  const group = leaf ? getSubjectGroup(leaf.group.slug) : getSubjectGroup(current)

  const href = (slug?: string) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(otherParams)) if (v) p.set(k, v)
    if (slug) p.set('subject', slug)
    const s = p.toString()
    return s ? `${basePath}?${s}` : basePath
  }

  const visible = (slug: string) => !counts || (counts[slug] ?? 0) > 0

  const chip = (label: string, slug: string | undefined, active: boolean, count?: number) => (
    <li key={slug ?? 'all'}>
      <Link
        href={href(slug)}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors',
          active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground',
        )}
      >
        {label}
        {count !== undefined && <span className={cn('metric text-xs', active ? 'text-primary-foreground/80' : 'text-muted-foreground/70')}>{count}</span>}
      </Link>
    </li>
  )

  return (
    <nav aria-label="Filter by subject" className="space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {chip('All subjects', undefined, !group)}
        {SUBJECTS.filter((g) => visible(g.slug)).map((g) => chip(g.label, g.slug, group?.slug === g.slug, counts?.[g.slug]))}
      </ul>
      {group && (
        <ul className="flex flex-wrap gap-1.5 pl-1">
          {chip(`All ${group.label}`, group.slug, !leaf)}
          {group.leaves.filter((l) => visible(l.slug)).map((l) => chip(l.label, l.slug, leaf?.slug === l.slug, counts?.[l.slug]))}
        </ul>
      )}
    </nav>
  )
}
