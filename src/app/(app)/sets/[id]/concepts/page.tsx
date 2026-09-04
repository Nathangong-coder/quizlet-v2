import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireSetKltView } from '@/lib/klt/access'
import { ConceptTree } from '@/components/klt/ConceptTree'

/**
 * The per-set concept tree (spec Decision 3: kept alongside `/concepts`, not a
 * replacement for it).
 *
 * Gated by `requireSetKltView`, which admits anyone who may READ the set —
 * its owner, an admin, or someone holding the link to a link-shared set.
 * `canEdit` is what separates the editor from the read-only view; it comes
 * from the same rule the write gate applies, and every write re-checks
 * `requireSetKltAccess` server-side regardless of what this page decided to
 * render.
 *
 * A gate failure is a REAL 404 via `notFound()`, never a redirect or a "you
 * are not allowed" message: the not-found `ActionResult` shape every action in
 * this feature returns exists precisely so a stranger cannot learn a set id is
 * real from the response shape, and this page's gate must not undo that by
 * responding differently.
 */
export default async function SetConceptsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireSetKltView(id)
  if (!access) notFound()

  return (
    <div className="max-w-4xl space-y-4">
      <Link href={`/sets/${access.setId}`} className="text-sm text-muted-foreground hover:underline">
        &larr; Back to {access.setTitle}
      </Link>
      <ConceptTree
        setId={access.setId}
        setTitle={access.setTitle}
        canEdit={access.canEdit}
        isAdmin={access.viaRole}
      />
    </div>
  )
}
