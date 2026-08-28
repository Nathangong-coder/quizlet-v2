import { notFound } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadSetAnalysis } from '@/lib/sets/knowledge'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'
import { MisconceptionList, RetentionPanel } from '@/components/learner/RetentionPanel'
import { InProgressBlock } from '@/components/sets/knowledge/InProgressBlock'
import { SetAnalysisEmpty } from '@/components/sets/knowledge/SetAnalysisEmpty'

/**
 * Analysis — why you get things wrong.
 *
 * Knowledge answers "what do I know"; this answers "what is going wrong, and
 * what shape is it". Same scope object as Knowledge, so the two tabs cannot
 * disagree about which answers they are describing.
 *
 * SHIPS MOSTLY REAL, revising the 2026-08-27 decision to stub it entirely.
 * `getLearnerMetrics` scoped to one set already returns a forgetting curve,
 * misconceptions and pace outliers, and the panels that render them already
 * exist — stubbing the tab would have hidden working analysis behind a
 * placeholder, and a locked tab beside two working ones reads as broken.
 *
 * What genuinely IS unbuilt — error rates by (dimension, type, target) and the
 * significance bands that rank them — is Spec 4, and is marked as such rather
 * than faked.
 *
 * ON THE ENFORCED_PATHS CHECKLIST.
 */
export default async function SetAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const set = await prisma.set.findFirst({
    where: { id, ...readableSetWhere(viewerId) },
    select: { id: true },
  })
  if (!set) notFound()

  if (!viewerId) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>{' '}
        to see an analysis of how you answer this set. There is nothing to analyse until you
        have answered something, and what you answer is your own.
      </p>
    )
  }

  const { metrics, empty } = await loadSetAnalysis(viewerId, id)

  return (
    <div className="space-y-8">
      {/*
        FIVE causes, five remedies — via `diagnoseEmptyState`, shared with the
        learner dashboard and with scripts/tuning-check.ts so the gate and the
        page can never disagree about whether there is enough data. An earlier
        draft of this page hand-rolled a single "nothing to analyse yet"
        message, which is the exact merge that function exists to prevent: the
        3B live gate produced two of these causes and both read as a broken
        feature until they were diagnosed against the database.

        A `blocking` cause replaces the panels; a non-blocking one sits above
        real content and explains a gap in it.
      */}
      {empty && <SetAnalysisEmpty cause={empty} setId={id} />}

      {empty?.blocking ? null : (
      <>
      <Section>
        <SectionHeader title="Retention and pace" hint="this set only" />
        <SectionBody>
          <RetentionPanel forgetting={metrics.forgetting} paceOutliers={metrics.paceOutliers} />
        </SectionBody>
      </Section>

      <Section>
        <SectionHeader title="Misconceptions" hint="ideas you mix up" />
        <SectionBody>
          <MisconceptionList misconceptions={metrics.misconceptions} />
        </SectionBody>
      </Section>

      <Section>
        <SectionHeader title="Coming to this page" />
        <SectionBody>
          <InProgressBlock
            title="Error taxonomy"
            needs="answers analysed against key-point provenance — multiple choice and true/false produce it with no AI call, short answer needs a grading pass"
          >
            <p>
              Every wrong answer is already recorded as a triple — which dimension it failed
              on, which type of error it was, and which key point it was about — alongside a
              computed significance. What is missing is the view over them: error rates by
              type, ranked by significance, so this page can say <em>you are not weak on
              valuation, you are inverting one relationship inside it</em>.
            </p>
            <p>
              It is deliberately not sketched here with sample numbers. A dimmed chart of
              invented bands is indistinguishable from a real one at a glance, and a number
              nobody computed is worse than no number.
            </p>
          </InProgressBlock>
        </SectionBody>
      </Section>
      </>
      )}

      <p className="text-sm text-muted-foreground">
        Across every set, the same analysis lives on your{' '}
        <Link href="/profile/learner" className="underline underline-offset-4">
          learner profile
        </Link>
        .
      </p>
    </div>
  )
}
