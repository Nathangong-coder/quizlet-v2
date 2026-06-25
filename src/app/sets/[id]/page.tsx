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

      <div className="flex gap-3 mb-8">
        <Link
          href={`/sets/${id}/match`}
          className={cn(
            buttonVariants({ size: 'lg' }),
            'bg-white text-black border border-black hover:bg-black hover:text-white px-6 py-3'
          )}
        >
          Matching Game
        </Link>
        {session?.user?.id && (
          <Link
            href={`/sets/${id}/review`}
            className={cn(
              buttonVariants({ size: 'lg' }),
              'bg-white text-black border border-black hover:bg-black hover:text-white px-6 py-3'
            )}
          >
            Review Mode
          </Link>
        )}
      </div>

      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-xl font-semibold">Terms List</h2>
        <Separator className="flex-1" />
      </div>

      <div className="space-y-3">
        {set.cards.map((card) => {
          const progress = progressByCardId.get(card.id)
          return (
            <Card key={card.id}>
              <CardContent className="pt-4 grid grid-cols-[1fr_1fr_auto] gap-4 items-start">
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                    Term
                  </p>
                  <p className="font-medium">{card.term}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                    Definition
                  </p>
                  <p>{card.definition}</p>
                </div>
                {session?.user?.id && (
                  <div className="flex flex-col items-center gap-3 pt-5">
                    <StarButton
                      cardId={card.id}
                      setId={id}
                      starred={progress?.starred ?? false}
                    />
                    <ConfidenceRate
                      cardId={card.id}
                      setId={id}
                      initialConfidence={progress?.confidence ?? 5}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
