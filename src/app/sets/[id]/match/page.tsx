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
import { loadLivePieces } from '@/lib/games/load'
import { playablePieces, MIN_PIECES } from '@/lib/games/pieces'

export default async function MatchGamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ cat?: string; source?: string }>
}) {
  const { id } = await params
  const { cat, source } = await searchParams
  // Anonymous-playable on a link/public set (2026-09-13): Match writes
  // nothing, so there is nothing to gate behind sign-in. `readableSetWhere`
  // is what decides which sets an anonymous visitor can see.
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

  // `?source=pieces`: tiles from the set's game pieces (short prompt/answer
  // pairs made from key points) instead of whole cards — the only way a set
  // of paragraph-length definitions can be a tile game. Design: learning
  // games spec §3. The category filter does not apply to pieces.
  if (source === 'pieces') {
    const pieces = playablePieces(await loadLivePieces(id))
    if (pieces.length < MIN_PIECES.match) {
      return (
        <div className="max-w-4xl mx-auto px-4 py-8">
          <BackLink id={id} />
          <p className="py-16 text-center text-muted-foreground">Needs {MIN_PIECES.match - pieces.length} more pieces. The set owner can prepare them from the games hub.</p>
        </div>
      )
    }
    const asCards = pieces.map((pc) => ({ id: pc.id, term: pc.prompt, definition: pc.answer }))
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <BackLink id={id} />
        <p className="mb-4 text-xs text-muted-foreground">Matching key points, not whole cards. <Link href={`/sets/${id}/match`} className="underline underline-offset-4">Play on cards instead</Link></p>
        <MatchGame key="pieces" setId={id} source="pieces" initialTiles={initMatchGame(asCards, crypto.randomUUID()).tiles} />
      </div>
    )
  }

  const filtered = filterCardsByCategories(cardsWithCats, selected)

  const categories = set.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <BackLink id={id} />

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

function BackLink({ id }: { id: string }) {
  return (
    <div className="mb-6">
      <Link
        href={`/sets/${id}/games`}
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'flex items-center gap-2 -ml-2')}
      >
        <ArrowLeft className="w-4 h-4" />
        Games
      </Link>
    </div>
  )
}
