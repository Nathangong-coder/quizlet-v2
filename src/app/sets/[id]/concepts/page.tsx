import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireSetKltAccess } from '@/lib/klt/access'
import { ConceptTree } from '@/components/klt/ConceptTree'

/**
 * The per-set concept-tree editor (spec Decision 3: kept alongside `/concepts`,
 * not a replacement for it).
 *
 * Gated by `requireSetKltAccess`, which admits the set's OWNER or a
 * `KLT_EDITORS` operator — the same helper `/concepts` uses to pick a set to
 * land here. A gate failure is a REAL 404 via `notFound()`, never a redirect
 * or a "you are not allowed" message: the not-found `ActionResult` shape
 * every action in this feature returns exists precisely so a stranger cannot
 * learn a set id is real from the response shape, and this page's gate must
 * not undo that by responding differently.
 */
export default async function SetConceptsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireSetKltAccess(id)
  if (!access) notFound()

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-4">
      <Link href={`/sets/${access.setId}`} className="text-sm text-muted-foreground hover:underline">
        &larr; Back to {access.setTitle}
      </Link>
      <ConceptTree setId={access.setId} setTitle={access.setTitle} />
    </div>
  )
}
