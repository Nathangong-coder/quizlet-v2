import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import ReviewSession from '@/components/review/ReviewSession'

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect('/api/auth/signin')

  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      cards: {
        orderBy: { position: 'asc' },
        include: {
          progress: { where: { userId: session.user.id } },
        },
      },
    },
  })

  if (!set) notFound()

  if (set.cards.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground mb-4">No cards in this set yet.</p>
        <Button asChild>
          <Link href={`/sets/${id}/edit`}>Add cards</Link>
        </Button>
      </div>
    )
  }

  const reviewCards = set.cards.map((card) => ({
    id: card.id,
    term: card.term,
    definition: card.definition,
    confidence: card.progress[0]?.confidence ?? 5,
  }))

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link href={`/sets/${id}`}>← Back to {set.title}</Link>
        </Button>
        <h1 className="text-2xl font-bold">Review Mode</h1>
        <p className="text-sm text-muted-foreground mt-1">{reviewCards.length} cards</p>
      </div>
      <ReviewSession cards={reviewCards} setId={id} />
    </div>
  )
}
