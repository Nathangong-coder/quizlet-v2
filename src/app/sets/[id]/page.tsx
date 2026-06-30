import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import StarButton from '@/components/sets/StarButton'
import FlashcardSection from '@/components/flashcard/FlashcardSection'
import DeleteSetForm from '@/components/sets/DeleteSetForm'
import ConfidenceRate from '@/components/sets/ConfidenceRate'
import { cn } from '@/lib/utils'
import { TermsList } from '@/components/sets/TermsList'
import { ActivityTiles } from '@/components/sets/ActivityTiles'

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()

  const [set, progressList] = await Promise.all([
    prisma.set.findUnique({
      where: { id },
      include: { cards: { orderBy: { position: 'asc' } } },
    }),
    session?.user?.id
      ? prisma.cardProgress.findMany({
          where: { userId: session.user.id, card: { setId: id } },
          select: { cardId: true, confidence: true, starred: true },
        })
      : Promise.resolve([]),
  ])

  if (!set) notFound()

  const isOwner = session?.user?.id === set.userId
  const progressByCardId = new Map(progressList.map((p) => [p.cardId, p]))

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-3xl font-bold">{set.title}</h1>
          {set.description && (
            <p className="text-muted-foreground mt-1">{set.description}</p>
          )}
        </div>
        {isOwner && (
          <div className="flex gap-2">
            <Link
              href={`/sets/${id}/edit`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Edit
            </Link>
            <DeleteSetForm setId={id} />
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-6">{set.cards.length} cards</p>

      {set.cards.length > 0 && (
        <FlashcardSection
          cards={set.cards.map((c) => ({
            id: c.id,
            term: c.term,
            definition: c.definition,
          }))}
        />
      )}

      <ActivityTiles id={id} userId={session?.user?.id} />

      <TermsList
        cards={set.cards}
        progressMap={progressByCardId}
        userId={session?.user?.id}
        setId={id}
      />
    </div>
  )
}
