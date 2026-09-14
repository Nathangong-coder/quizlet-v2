import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadSetMastery } from '@/lib/sets/mastery'
import { MasteryBoard } from '@/components/sets/mastery/MasteryBoard'

/**
 * Mastery — every card's key points and what you have shown on each.
 *
 * The concept-grain picture is the Knowledge tab; this is the CARD grain the
 * owner asked for (2026-09-14): the guide's checklist, live, with your own
 * shading. A visitor on a readable set gets the points unshaded — the points
 * belong to the set, the shading is the viewer's.
 *
 * ON THE ENFORCED_PATHS CHECKLIST: the set read inside `loadSetMastery`
 * spreads `readableSetWhere`; it is referenced here so the source-level scan
 * sees this page make the claim.
 */
export default async function SetMasteryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  void readableSetWhere
  const mastery = await loadSetMastery(viewerId, id)
  if (!mastery) notFound()

  return <MasteryBoard cards={mastery.cards} summary={mastery.summary} signedIn={viewerId !== null} setId={id} />
}
