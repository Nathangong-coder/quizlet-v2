import { notFound } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadSetKnowledge } from '@/lib/sets/knowledge'
import { parseConceptView } from '@/lib/sets/views'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'
import { Metric } from '@/components/ui/metric'
import { ConceptMastery } from '@/components/sets/knowledge/ConceptMastery'
import { CategoryMastery } from '@/components/sets/knowledge/CategoryMastery'
import { ConfidenceBars } from '@/components/sets/knowledge/ConfidenceBars'
import { SetHistory } from '@/components/sets/knowledge/SetHistory'

/**
 * Knowledge — what you know about this set.
 *
 * Everything here is about YOU and this set, drawn entirely from data that
 * already exists: `CardProgress`, `StudyEvent`, `StudySession`, `KlpState`,
 * `SetKltNode`, `CardCategory`. This feature added no columns, on purpose — a
 * view that needs new writes before it says anything cannot be judged until
 * those writes have accumulated.
 *
 * SIGNED OUT IS A REAL CASE, not an error. A link-shared or public set is
 * readable with no session, and such a visitor has no progress on it. They get
 * the concept map UNSHADED — the structure belongs to the set and they may
 * already read every card it organizes — plus a prompt where the personal
 * panels would be. Neither 404s, and neither pretends there is data.
 *
 * ON THE ENFORCED_PATHS CHECKLIST.
 */
export default async function SetKnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { id } = await params
  const { view } = await searchParams
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  // The layout has already resolved this set, but a page's query does not
  // inherit a layout's guard — and a guard that lives somewhere else is the
  // shape `ENFORCED_PATHS` exists to catch.
  const set = await prisma.set.findFirst({
    where: { id, ...readableSetWhere(viewerId) },
    select: { id: true, userId: true },
  })
  if (!set) notFound()

  const conceptView = parseConceptView(view)
  const isOwner = viewerId === set.userId

  if (!viewerId) {
    return (
      <div className="space-y-8">
        <Section>
          <SectionHeader title="Concepts" hint="how this set is organized" />
          <SectionBody>
            <ConceptMastery
              setId={id}
              rows={[]}
              // Unshaded: there is no viewer to have mastery. An empty map is
              // NOT the same as one shaded entirely `unknown`, which would
              // claim a measurement was attempted.
              shades={{}}
              initialView={conceptView}
              canEdit={false}
            />
          </SectionBody>
        </Section>

        <Section>
          <SectionHeader title="Your progress" />
          <SectionBody>
            <p className="text-sm text-muted-foreground">
              <Link href="/login" className="underline underline-offset-4">
                Sign in
              </Link>{' '}
              to track what you know about this set. Your progress on someone else&apos;s set
              is your own — the owner never sees it.
            </p>
          </SectionBody>
        </Section>
      </div>
    )
  }

  const knowledge = await loadSetKnowledge(viewerId, id)
  // Counted over the WHOLE concept axis, not the listed rung — the tile says
  // "Concepts measured" about this set, and a rung-sized count would shrink
  // every time the list picked a narrower level.
  const measured = knowledge.measuredConceptCount

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {/* `Metric` renders an em dash for null and never 0 — an unstudied set
            must not report "you know none of this". */}
        <Metric value={knowledge.confidence.studied} label="Cards rated" emptyLabel="—" />
        <Metric
          value={knowledge.confidence.average}
          label="Mean confidence"
          unit="/10"
          emptyLabel="—"
        />
        <Metric value={knowledge.confidence.due} label="Due now" emptyLabel="—" />
        <Metric value={measured} label="Concepts measured" emptyLabel="—" />
      </div>

      <Section>
        <SectionHeader
          title="Concepts"
          hint={
            measured > 0
              ? `${measured} of ${knowledge.conceptCount} measured`
              : 'nothing measured yet'
          }
        />
        <SectionBody>
          {/* Two different slices of ONE axis: the list shows a single rung
              (`topics`), the map shades every node (`conceptShades`). Deriving
              the second from the first would leave every node off that rung
              unshaded. */}
          <ConceptMastery
            setId={id}
            rows={knowledge.topics}
            shades={knowledge.conceptShades}
            initialView={conceptView}
            canEdit={isOwner}
          />
        </SectionBody>
      </Section>

      {/* BELOW the concepts, and separate from them, because they are a
          different axis rather than a finer grain of the same one — a category
          is whatever the learner found useful to label with, and in practice
          that is often a FORMAT ("label the image", "talking") rather than a
          subject. See CLAUDE.md, 2026-08-14. */}
      <Section>
        <SectionHeader title="Your categories" hint={`${knowledge.categories.length}`} />
        <SectionBody>
          <CategoryMastery rows={knowledge.categories} />
        </SectionBody>
      </Section>

      <Section>
        <SectionHeader title="Confidence" hint="how sure you say you are" />
        <SectionBody>
          <ConfidenceBars histogram={knowledge.confidence} />
        </SectionBody>
      </Section>

      <Section>
        <SectionHeader
          title="Your history with this set"
          action={
            <Link href={`/profile/memory?sets=${id}`} className="underline underline-offset-4">
              Full history
            </Link>
          }
        />
        <SectionBody>
          <SetHistory rows={knowledge.sessions} />
        </SectionBody>
      </Section>
    </div>
  )
}
