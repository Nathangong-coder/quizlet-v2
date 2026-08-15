import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import FlashcardSection from '@/components/flashcard/FlashcardSection'
import DeleteSetForm from '@/components/sets/DeleteSetForm'
import { cn } from '@/lib/utils'
import { loadSetStudySummaries } from '@/lib/sets/study-summary'
import { TermsList } from '@/components/sets/TermsList'
import { ActivityTiles } from '@/components/sets/ActivityTiles'
import { readableSetWhere, toSetVisibility } from '@/lib/sets/visibility'
import VisibilityToggle from '@/components/sets/VisibilityToggle'

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  // Explicitly null, never a bare `session?.user?.id`: a link-shared set is
  // readable signed-out by design, so this page must NOT require a session.
  const viewerId = session?.user?.id ?? null

  const [set, progressList] = await Promise.all([
    prisma.set.findFirst({
      where: { id, ...readableSetWhere(viewerId) },
      include: {
        cards: {
          orderBy: { position: 'asc' },
          include: {
            contentBlocks: { orderBy: { position: 'asc' } },
            categoryAssignments: { include: { category: true } },
          }
        }
      },
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

  // Same helper the sets list uses, so the two surfaces cannot report a
  // different number of due cards for the same set.
  const summary = session?.user?.id
    ? (await loadSetStudySummaries(prisma, session.user.id, [id]))[id]
    : undefined

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

      <p className="text-sm text-muted-foreground mb-4">
        {set.cards.length} cards
        {summary && summary.studiedCards > 0 && (
          <>
            {' · '}
            {summary.studiedCards} studied
            {summary.averageConfidence !== null &&
              ` · confidence ${summary.averageConfidence.toFixed(1)}/10`}
            {summary.dueCount > 0 && ` · ${summary.dueCount} due`}
          </>
        )}
      </p>

      {isOwner ? (
        <div className="mb-6">
          <VisibilityToggle setId={id} visibility={toSetVisibility(set.visibility)} />
        </div>
      ) : (
        // Study writes are keyed (userId, cardId), so a viewer's confidence,
        // events and quiz history genuinely never touch the owner's. True, but
        // not something anyone should have to infer before they start studying
        // on someone else's set.
        <div className="mb-6 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          Someone shared this set with you. You can study it, but not edit it — and your
          progress is your own.
        </div>
      )}

      {set.cards.length > 0 && (
        <FlashcardSection
          cards={set.cards.map((c) => ({
            id: c.id,
            term: c.term,
            definition: c.definition,
            categories: c.categoryAssignments.map((a) => ({ name: a.category.name, color: a.category.color })),
            contentBlocks: c.contentBlocks.map(b => ({
              id: b.id,
              type: b.type as 'text' | 'image' | 'video' | 'file',
              position: b.position,
              side: b.side as 'term' | 'definition',
              text: b.text ?? undefined,
              assetId: b.assetId ?? undefined,
            })),
          }))}
        />
      )}

      <ActivityTiles id={id} userId={session?.user?.id} />

      <TermsList
        cards={set.cards.map((c) => ({
          id: c.id,
          term: c.term,
          definition: c.definition,
          categories: c.categoryAssignments.map((a) => ({ name: a.category.name, color: a.category.color })),
          contentBlocks: c.contentBlocks.map(b => ({
            id: b.id,
            type: b.type as 'text' | 'image' | 'video' | 'file',
            position: b.position,
            side: b.side as 'term' | 'definition',
            text: b.text ?? undefined,
            assetId: b.assetId ?? undefined,
          })),
        }))}
        progressMap={progressByCardId}
        userId={session?.user?.id}
        setId={id}
      />
    </div>
  )
}
