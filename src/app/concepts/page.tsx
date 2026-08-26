import { auth } from '@/auth'
import { notFound } from 'next/navigation'
import { isKltEditor } from '@/lib/klt/editors'
import { ConceptTree } from '@/components/klt/ConceptTree'

/**
 * The global concept-tree editor. Gated by `isKltEditor` — an operator
 * allowlist, not a per-row permission, because the tree has no owner: it is
 * shared across every account, so a re-parent here moves everyone's topic
 * mastery.
 *
 * A non-editor gets a REAL 404 via `notFound()`, never a redirect or a
 * "you are not allowed" message — someone who should not know this route
 * exists must not learn that it does.
 */
export default async function ConceptsPage() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId || !isKltEditor(userId)) notFound()

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <ConceptTree />
    </div>
  )
}
