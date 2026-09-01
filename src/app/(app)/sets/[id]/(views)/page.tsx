import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import FlashcardSection from '@/components/flashcard/FlashcardSection'
import { TermsList } from '@/components/sets/TermsList'
import { ActivityTiles } from '@/components/sets/ActivityTiles'
import { readableSetWhere } from '@/lib/sets/visibility'
import { normalizeTextMarks } from '@/lib/cards/content'

/**
 * Study — what you DO with the set.
 *
 * Deliberately unchanged in substance. The study flow was the one part of the
 * app nobody complained about, so this view kept its activity tiles, its
 * carousel and its full term list; what left was the header (now in the
 * layout, shared by all three tabs) and the outline "Concepts" button (now the
 * Knowledge tab).
 *
 * CATEGORY CHIPS AND CONFIDENCE STAY ON THE CARDS. Knowledge AGGREGATES them;
 * it does not take them away. A chip on a card answers "what is this?" in
 * context; the same data on Knowledge answers "how am I doing across them?"
 * Those are different questions, and the second does not replace the first.
 *
 * ON THE ENFORCED_PATHS CHECKLIST. The layout above also reads the set through
 * `readableSetWhere`, but this page issues its OWN read for the cards and must
 * carry its own guard — a layout's check is not inherited by a page's query,
 * and relying on it would be a guard that exists somewhere else.
 */
export default async function SetStudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const [set, progressList] = await Promise.all([
    prisma.set.findFirst({
      where: { id, ...readableSetWhere(viewerId) },
      select: {
        id: true,
        cards: {
          orderBy: { position: 'asc' },
          include: {
            contentBlocks: { orderBy: { position: 'asc' } },
            categoryAssignments: { include: { category: true } },
          },
        },
      },
    }),
    viewerId
      ? prisma.cardProgress.findMany({
          where: { userId: viewerId, card: { setId: id } },
          select: { cardId: true, confidence: true, starred: true },
        })
      : Promise.resolve([]),
  ])

  if (!set) notFound()

  const progressByCardId = new Map(progressList.map((p) => [p.cardId, p]))

  const cards = set.cards.map((c) => ({
    id: c.id,
    term: c.term,
    definition: c.definition,
    categories: c.categoryAssignments.map((a) => ({
      name: a.category.name,
      color: a.category.color,
    })),
    contentBlocks: c.contentBlocks.map((b) => ({
      id: b.id,
      type: b.type as 'text' | 'image' | 'video' | 'file',
      position: b.position,
      side: b.side as 'term' | 'definition',
      text: b.text ?? undefined,
      assetId: b.assetId ?? undefined,
      marks: normalizeTextMarks(b.marks, (b.text ?? '').length),
    })),
  }))

  return (
    <>
      <ActivityTiles id={id} userId={viewerId ?? undefined} />

      {cards.length > 0 && <FlashcardSection cards={cards} />}

      <TermsList
        cards={cards}
        progressMap={progressByCardId}
        userId={viewerId ?? undefined}
        setId={id}
      />
    </>
  )
}
