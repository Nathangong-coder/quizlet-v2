import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { ReviewMode } from '@/components/review/ReviewMode'
import { cn } from '@/lib/utils'
import { readableSetWhere } from '@/lib/sets/visibility'
import { normalizeTextMarks } from '@/lib/cards/content'
import { nowMs, type ReviewCardInput } from '@/lib/review/setup'

/**
 * `/sets/[id]/review` — Review mode, with a setup screen first (owner,
 * 2026-09-14): starred / due / weak, categories, which side, the order. The
 * page loads every card with the viewer's progress; the deck is chosen on
 * the client by `selectReviewCards`, so the count on the Start button is the
 * deck you get.
 *
 * Sign-in stays required — reviewing writes study memory keyed to a userId.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=' + encodeURIComponent(`/sets/${id}/review`))

  const set = await prisma.set.findFirst({
    where: { id, ...readableSetWhere(session.user.id) },
    include: {
      categories: { orderBy: { name: 'asc' } },
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
      <div className="py-16 text-center">
        <p className="mb-4 text-muted-foreground">No cards in this set yet.</p>
        <Link href={`/sets/${id}/edit`} className={cn(buttonVariants())}>
          Add cards
        </Link>
      </div>
    )
  }

  const categories = set.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))
  const cards: ReviewCardInput[] = set.cards.map((card) => {
    const p = card.progress[0]
    return {
      id: card.id,
      term: card.term,
      definition: card.definition,
      contentBlocks: card.contentBlocks.map((b) => ({
        id: b.id,
        type: b.type as 'text' | 'image' | 'video' | 'file',
        position: b.position,
        side: b.side as 'term' | 'definition',
        text: b.text ?? undefined,
        assetId: b.assetId ?? undefined,
        marks: normalizeTextMarks(b.marks, (b.text ?? '').length),
      })),
      confidence: p?.confidence ?? 5,
      starred: p?.starred ?? false,
      // No progress row, or a row never scheduled: due now (getDueCards' rule).
      dueAt: p?.dueAt ? p.dueAt.getTime() : null,
      categoryIds: card.categoryAssignments.map((a) => a.categoryId),
    }
  })

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6">
        <Link href={`/sets/${id}`} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2 mb-1')}>
          ← Back to {set.title}
        </Link>
        <h1 className="font-heading text-2xl font-bold">Review</h1>
        <p className="mt-1 text-sm text-muted-foreground">Know it or don&rsquo;t — the deck remembers which.</p>
      </div>
      <ReviewMode cards={cards} categories={categories} setId={id} now={nowMs()} />
    </div>
  )
}
