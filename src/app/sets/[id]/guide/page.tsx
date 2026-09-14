import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadSetMastery } from '@/lib/sets/mastery'
import { StudyGuide } from '@/components/sets/mastery/StudyGuide'

export const metadata: Metadata = { title: 'Study guide', robots: { index: false, follow: false } }

/**
 * `/sets/[id]/guide` — the set as one printable page: categories as
 * sections, cards as headings, key points as a checklist, shaded by the
 * viewer's own mastery. A bare route (no app shell), like `/print`, so the
 * page IS the document. Readable by whoever can read the set; the shading
 * is the viewer's alone and a visitor gets none.
 */
export default async function StudyGuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  void readableSetWhere
  const mastery = await loadSetMastery(viewerId, id)
  if (!mastery) notFound()
  const printedOn = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return <StudyGuide mastery={mastery} printedOn={printedOn} />
}
