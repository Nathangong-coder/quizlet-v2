import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { isKltEditor } from '@/lib/klt/editors'

/**
 * The admin concept-tree PICKER. Structure moved from one global tree to a
 * per-set one (spec Decision 4), so there is no single tree left to render
 * here — this page's whole job is letting an operator find a set and hand off
 * to `/sets/[id]/concepts`, which renders the SAME `ConceptTree` component
 * the set's own owner uses (spec Decision 3: two entry points, one editor).
 *
 * Gated by `isKltEditor` — an operator allowlist, not a per-row permission,
 * because picking a set here is itself the operator capability: an ordinary
 * owner reaches their own set's editor directly from the set page, never
 * through this list.
 *
 * A non-editor gets a REAL 404 via `notFound()`, never a redirect or a
 * "you are not allowed" message — someone who should not know this route
 * exists must not learn that it does.
 */
export default async function ConceptsPage() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId || !isKltEditor(userId)) notFound()

  const sets = await prisma.set.findMany({
    select: {
      id: true,
      title: true,
      user: { select: { name: true, email: true } },
      _count: { select: { cards: true, kltNodes: true } },
    },
    orderBy: { title: 'asc' },
  })

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Concept trees</h1>
        <p className="text-sm text-muted-foreground">
          Pick a set to open its concept editor. Every edit you make there affects only that one
          set — the same guarantee its owner has.
        </p>
      </div>

      {sets.length === 0 && <p className="text-sm text-muted-foreground">No sets yet.</p>}

      <ul className="divide-y rounded-lg border">
        {sets.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 p-3">
            <div>
              <Link href={`/sets/${s.id}/concepts`} className="font-medium hover:underline">
                {s.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {s.user.name ?? s.user.email} &middot; {s._count.cards} cards &middot;{' '}
                {s._count.kltNodes} concepts placed
              </p>
            </div>
            <Link
              href={`/sets/${s.id}/concepts`}
              className="text-sm text-primary hover:underline whitespace-nowrap"
            >
              Open editor
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
