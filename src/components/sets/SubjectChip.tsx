import Link from 'next/link'
import { BookMarked } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSubject } from '@/lib/subjects/taxonomy'

/**
 * "Business & Finance · Accounting", linking to Browse filtered on the leaf.
 * Renders nothing for a null or unrecognised slug — a persisted slug can
 * outlive the tree, and a chip that says "unknown" helps nobody.
 */
export function SubjectChip({ slug, className, link = true }: { slug: string | null | undefined; className?: string; link?: boolean }) {
  const subject = getSubject(slug)
  if (!subject) return null
  const body = (
    <>
      <BookMarked className="h-3 w-3" aria-hidden="true" />
      <span className="text-muted-foreground">{subject.group.label}</span>
      <span aria-hidden="true" className="text-muted-foreground/60">·</span>
      <span>{subject.label}</span>
    </>
  )
  const cls = cn(
    'inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs font-medium',
    link && 'hover:border-primary/60',
    className,
  )
  return link ? (
    <Link href={`/browse?subject=${subject.slug}`} className={cls} title={`Browse ${subject.label} sets`}>
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  )
}
