import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import { after } from 'next/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import FlashcardSection from '@/components/flashcard/FlashcardSection'
import DeleteSetForm from '@/components/sets/DeleteSetForm'
import { cn } from '@/lib/utils'
import { TermsList } from '@/components/sets/TermsList'
import { ActivityTiles } from '@/components/sets/ActivityTiles'
import { readableSetWhere } from '@/lib/sets/visibility'
import { recordSetView } from '@/lib/sets/recents'
import { ForkButton } from '@/components/sets/ForkButton'
import { ForkAttribution } from '@/components/sets/ForkAttribution'

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

  // AFTER the notFound guard, so a probe for a set id that does not exist (or
  // that this viewer may not read) never writes a row — which would make the
  // recents table a record of what someone guessed at.
  //
  // In `after()` rather than inline: writing during a Server Component's
  // render is unsafe under caching and PPR, and a recents row must never be
  // able to fail the page. Same pattern as KLP extraction.
  if (viewerId) {
    const seenSetId = set.id
    after(() => recordSetView(viewerId, seenSetId))
  }

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
          {/*
            Renders nothing at all unless this set is a fork. The credit text
            comes from the denormalized columns; only the LINK consults the
            database, and only through `readableSetWhere`.
          */}
          <ForkAttribution
            forkedFromId={set.forkedFromId}
            forkedFromTitle={set.forkedFromTitle}
            forkedFromHandle={set.forkedFromHandle}
            viewerId={viewerId}
          />
        </div>
        <div className="flex gap-2">
          {/*
            Concepts is NOT inside the owner block. Anyone who reached this
            page may read every card the tree organizes, so hiding the map
            while handing over the territory bought nothing; the page itself
            renders read-only for a non-owner, and every structural write is
            gated server-side by `requireSetKltAccess` either way.
          */}
          <Link
            href={`/sets/${id}/concepts`}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            Concepts
          </Link>
          {/*
            Non-owners only. Duplicating your OWN set is a different verb and
            does not belong on this row; the fork action itself allows it, so
            this is a UI choice rather than a restriction.
          */}
          {!isOwner && viewerId && <ForkButton setId={id} />}
          {isOwner && (
            <>
              <Link
                href={`/sets/${id}/edit`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                Edit
              </Link>
              <DeleteSetForm setId={id} />
            </>
          )}
        </div>
      </div>

      {/*
        Card count only. The studied-count and mean confidence that used to
        trail it were a score reported back at the learner every time they
        opened their own material; the same numbers live on the profile, where
        looking at them is a choice.
      */}
      <p className="text-sm text-muted-foreground mb-4">{set.cards.length} cards</p>

      {/*
        The activities sit here, where the visibility panel used to. Visibility
        is a setting you change rarely and it occupied the most valuable block
        on the page; it now lives at the top of the Edit screen. What belongs
        directly under a set's title is what you came to do with it.
      */}
      <ActivityTiles id={id} userId={session?.user?.id} />

      {!isOwner && (
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
