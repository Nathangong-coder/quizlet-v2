import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import ReviewSession from '@/components/review/ReviewSession'
import { cn } from '@/lib/utils'
import { filterCardsByCategories } from '@/lib/cards/categories'
import { CategoryUrlFilter } from '@/components/sets/CategoryUrlFilter'
import { readableSetWhere } from '@/lib/sets/visibility'

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ cat?: string }>
}) {
  const { id } = await params
  const { cat } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect('/api/auth/signin')

  // Sign-in stays required — reviewing writes study memory keyed to a userId.
  const set = await prisma.set.findFirst({
    where: { id, ...readableSetWhere(session.user.id) },
    include: {
      categories: true,
      cards: {
        orderBy: { position: 'asc' },
        include: {
          progress: { where: { userId: session.user.id } },
          contentBlocks: { orderBy: { position: 'asc' } },
          categoryAssignments: true,
        },
      },
    },
  })

  if (!set) notFound()

  if (set.cards.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground mb-4">No cards in this set yet.</p>
        <Link
          href={`/sets/${id}/edit`}
          className={cn(buttonVariants())}
        >
          Add cards
        </Link>
      </div>
    )
  }

  const selected = cat?.split(',').filter(Boolean) ?? []
  const filteredCards = filterCardsByCategories(
    set.cards.map((c) => ({ card: c, categoryIds: c.categoryAssignments.map((a) => a.categoryId) })),
    selected,
  ).map((x) => x.card)

  const categories = set.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))

  const reviewCards = filteredCards.map((card) => ({
    id: card.id,
    term: card.term,
    definition: card.definition,
    contentBlocks: card.contentBlocks.map(b => ({
      id: b.id,
      type: b.type as 'text' | 'image' | 'video' | 'file',
      position: b.position,
      side: b.side as 'term' | 'definition',
      text: b.text ?? undefined,
      assetId: b.assetId ?? undefined,
    })),
    confidence: card.progress[0]?.confidence ?? 5,
  }))

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <Link
          href={`/sets/${id}`}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2 mb-1')}
        >
          ← Back to {set.title}
        </Link>
        <h1 className="text-2xl font-bold">Review Mode</h1>
        <p className="text-sm text-muted-foreground mt-1">{reviewCards.length} cards</p>
      </div>
      <CategoryUrlFilter categories={categories} />
      {reviewCards.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-2">No cards match the selected categories.</p>
          {selected.length > 0 && (
            <Link href={`/sets/${id}/review`} className="text-primary underline text-sm">
              Clear filter
            </Link>
          )}
        </div>
      ) : (
        <ReviewSession key={cat ?? 'all'} cards={reviewCards} setId={id} />
      )}
    </div>
  )
}
