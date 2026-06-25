import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { deleteSet } from '@/actions/sets'
import StarButton from '@/components/sets/StarButton'
import FlashcardSection from '@/components/flashcard/FlashcardSection'

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
            <Button asChild variant="outline" size="sm">
              <Link href={`/sets/${id}/edit`}>Edit</Link>
            </Button>
            <form action={deleteSet.bind(null, id)}>
              <Button variant="destructive" size="sm" type="submit">
                Delete
              </Button>
            </form>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-6">{set.cards.length} cards</p>

      <div className="flex gap-3 mb-8">
        <Button asChild>
          <Link href={`/sets/${id}/match`}>Matching Game</Link>
        </Button>
        {session?.user?.id && (
          <Button asChild variant="outline">
            <Link href={`/sets/${id}/review`}>Review Mode</Link>
          </Button>
        )}
      </div>

      {set.cards.length > 0 && (
        <FlashcardSection
          cards={set.cards.map((c) => ({
            id: c.id,
            term: c.term,
            definition: c.definition,
          }))}
        />
      )}

      <Separator className="mb-6" />

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
                  <div className="flex flex-col items-center gap-2 pt-5">
                    <StarButton
                      cardId={card.id}
                      setId={id}
                      starred={progress?.starred ?? false}
                    />
                    <Badge variant="outline" className="text-xs font-mono px-1.5">
                      {progress?.confidence ?? 5}/10
                    </Badge>
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
