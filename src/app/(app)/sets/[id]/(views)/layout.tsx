import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import { after } from 'next/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import DeleteSetForm from '@/components/sets/DeleteSetForm'
import { readableSetWhere, toSetVisibility } from '@/lib/sets/visibility'
import { recordSetView } from '@/lib/sets/recents'
import { ForkButton } from '@/components/sets/ForkButton'
import { ForkAttribution } from '@/components/sets/ForkAttribution'
import ReportSetDialog from '@/components/sets/ReportSetDialog'
import { SetViewTabs } from '@/components/sets/SetViewTabs'

/**
 * The shared frame for the three views of a set.
 *
 * A ROUTE GROUP, not a `layout.tsx` at `sets/[id]`. A layout there would also
 * wrap `edit` — a long authoring form — and `concepts`, which is a full-bleed
 * drag-and-drop canvas. Neither wants a tab strip claiming it is one of three
 * peer views. (The five study activities were already moved outside `(app)`
 * entirely by the shell work, so they were never at risk here; `edit` and
 * `concepts` still are, and this group is what protects them.)
 *
 * The header lives HERE rather than in each page so the title, the fork credit
 * and the owner actions cannot drift between tabs or re-render on a tab change.
 *
 * ON THE ENFORCED_PATHS CHECKLIST — the one set read for all three views
 * happens here, through `readableSetWhere`.
 */
export default async function SetViewsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  // Explicitly null, never a bare `session?.user?.id`: a link-shared set is
  // readable signed-out by design, so this layout must NOT require a session.
  const viewerId = session?.user?.id ?? null

  const set = await prisma.set.findFirst({
    where: { id, ...readableSetWhere(viewerId) },
    select: {
      id: true,
      title: true,
      description: true,
      userId: true,
      visibility: true,
      listingBlocked: true,
      forkedFromId: true,
      forkedFromTitle: true,
      forkedFromHandle: true,
      _count: { select: { cards: true } },
    },
  })

  if (!set) notFound()

  // AFTER the notFound guard, so a probe for a set id that does not exist — or
  // that this viewer may not read — never writes a row, which would make the
  // recents table a record of what someone guessed at.
  //
  // Moved up from the Study page so that opening Knowledge or Analysis also
  // counts as having seen the set. Landing on a set's Knowledge tab from a link
  // and then losing it is the same failure recents exists to prevent.
  if (viewerId) {
    const seenSetId = set.id
    after(() => recordSetView(viewerId, seenSetId))
  }

  const isOwner = viewerId === set.userId

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="min-w-0">
          <h1 className="display">{set.title}</h1>
          {set.description && <p className="lede mt-2 max-w-prose">{set.description}</p>}
          {/* Renders nothing unless this set is a fork. The credit text comes
              from denormalized columns; only the LINK consults the database,
              and only through `readableSetWhere`. */}
          <ForkAttribution
            forkedFromId={set.forkedFromId}
            forkedFromTitle={set.forkedFromTitle}
            forkedFromHandle={set.forkedFromHandle}
            viewerId={viewerId}
          />
        </div>
        <div className="flex shrink-0 gap-2">
          {/*
            The outline "Concepts" button is GONE — it is the Knowledge tab
            now. `/sets/[id]/concepts` still exists and is still where the tree
            is authored; Knowledge embeds the canvas rather than replacing the
            editor.
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

      <p className="text-sm text-muted-foreground mb-6">
        {set._count.cards} {set._count.cards === 1 ? 'card' : 'cards'}
      </p>

      {/*
        THE REASON `listingBlocked` is a column separate from `visibility`: a
        moderation decision has to STICK and has to be VISIBLE. Flipping
        visibility back would be undone by the owner in one click, silently,
        without them ever learning a decision had been made about their set.
      */}
      {isOwner && set.listingBlocked && (
        <div className="mb-6 rounded-lg border border-warning/40 bg-warning-subtle p-4 text-sm">
          <p className="font-medium">This set has been removed from Browse.</p>
          <p className="text-muted-foreground mt-1">
            It is still readable by anyone holding its link, and you can still edit and study
            it. Publishing it again will not re-list it.
          </p>
        </div>
      )}

      {!isOwner && (
        // Study writes are keyed (userId, cardId), so a viewer's confidence,
        // events and quiz history genuinely never touch the owner's. True, but
        // not something anyone should have to infer before they start studying
        // on someone else's set.
        <div className="mb-6 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          Someone shared this set with you. You can study it, but not edit it — and your
          progress is your own.
          {/*
            Only PUBLIC sets are reportable. A link-shared set was handed to you
            personally, and a report queue that ingests those makes an operator
            a party to every study-group link — and `listingBlocked`, the only
            remedy that exists, is a no-op on something never listed.
          */}
          {viewerId && toSetVisibility(set.visibility) === 'public' && (
            <div className="mt-3">
              <ReportSetDialog setId={id} />
            </div>
          )}
        </div>
      )}

      <SetViewTabs setId={id} />

      <div className="pt-8">{children}</div>
    </div>
  )
}
