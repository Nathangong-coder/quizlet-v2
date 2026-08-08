import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { MatchGame } from '@/components/game/MatchGame'
import { initMatchGame } from '@/lib/game/match'
import { filterCardsByCategories } from '@/lib/cards/categories'
import { CategoryUrlFilter } from '@/components/sets/CategoryUrlFilter'
import { cn } from '@/lib/utils'

export default async function MatchGamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ cat?: string }>
}) {
  const { id } = await params
  const { cat } = await searchParams
  // This page had no auth() call at all. It gains one only to identify the
  // viewer for the readability check — NOT to require a session, since a
  // link-shared set is playable signed-out by design.
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const set = await prisma.set.findFirst({
    where: { id, ...readableSetWhere(viewerId) },
    include: {
      categories: true,
      cards: {
        orderBy: { position: 'asc' },
        include: { categoryAssignments: true },
      },
    },
  })

  if (!set) notFound()

  const selected = cat?.split(',').filter(Boolean) ?? []
  const cardsWithCats = set.cards.map((c) => ({
    id: c.id,
    term: c.term,
    definition: c.definition,
    categoryIds: c.categoryAssignments.map((a) => a.categoryId),
  }))
  const filtered = filterCardsByCategories(cardsWithCats, selected)

  const categories = set.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/sets/${id}`}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'flex items-center gap-2 -ml-2')}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to set
        </Link>
      </div>

      <CategoryUrlFilter categories={categories} />

      {filtered.length < 2 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-2">
            {set.cards.length < 2
              ? 'You need at least 2 cards to play the matching game.'
              : 'Fewer than 2 cards match the selected categories.'}
          </p>
          {selected.length > 0 && (
            <Link href={`/sets/${id}/match`} className="text-primary underline text-sm">
              Clear filter
            </Link>
          )}
        </div>
      ) : (
        <MatchGame key={cat ?? 'all'} setId={id} initialTiles={initMatchGame(filtered, crypto.randomUUID()).tiles} />
      )}
    </div>
  )
}
