import Link from 'next/link'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'

/**
 * "Copied from X by @y" on a forked set.
 *
 * THE RULE, and it is the whole component (design §7.3): the TEXT always comes
 * from the denormalized `forkedFromTitle`/`forkedFromHandle` captured at fork
 * time, never from a live join. Three states the FK alone cannot survive:
 *
 *  1. Source deleted — `SetNull` erases the link, and with it the credit. A
 *     fork that silently stops crediting anyone is worse than no attribution.
 *  2. Source made private — rendering a live join would LEAK THE TITLE AND
 *     EXISTENCE of a set the author just made private, on a page the author
 *     does not control. This is the privacy defect in this feature.
 *  3. Source renamed — the credit should describe what was actually forked.
 *
 * The link is the only part that consults the database, and it consults it
 * through `readableSetWhere` like any other read: linked when the source still
 * resolves FOR THIS VIEWER, plain text otherwise. The credit line therefore
 * never asserts that the source still exists or is still readable.
 */
export async function ForkAttribution({
  forkedFromId,
  forkedFromTitle,
  forkedFromHandle,
  viewerId,
}: {
  forkedFromId: string | null
  forkedFromTitle: string | null
  forkedFromHandle: string | null
  viewerId: string | null
}) {
  if (!forkedFromTitle) return null

  // Only asked when there is still a link to resolve. A deleted source is
  // already `null` here via `onDelete: SetNull`, so this saves a query on the
  // exact case that would return nothing anyway.
  const linkable =
    forkedFromId !== null &&
    (await prisma.set.findFirst({
      where: { id: forkedFromId, ...readableSetWhere(viewerId) },
      select: { id: true },
    })) !== null

  const credit = forkedFromHandle ? (
    <>
      {forkedFromTitle} by @{forkedFromHandle}
    </>
  ) : (
    <>{forkedFromTitle}</>
  )

  return (
    <p className="text-sm text-muted-foreground mt-1">
      Copied from{' '}
      {linkable && forkedFromId ? (
        <Link href={`/sets/${forkedFromId}`} className="underline underline-offset-4">
          {credit}
        </Link>
      ) : (
        credit
      )}
    </p>
  )
}
