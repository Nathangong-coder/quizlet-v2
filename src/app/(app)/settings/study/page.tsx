import { auth } from '@/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import SeverityBandPanel from '@/components/settings/SeverityBandPanel'
import TargetingStrategyPanel from '@/components/settings/TargetingStrategyPanel'
import MetricThresholdPanel from '@/components/settings/MetricThresholdPanel'
import StudyScopePanel from '@/components/settings/StudyScopePanel'
import { PageHeader } from '@/components/ui/page-header'

/**
 * "Other settings" — how the app judges you and what it puts in front of you.
 *
 * These four panels lived on `/settings/ai` until now, and that page's own
 * comment already anticipated this move: *"they live here because this is where
 * the learner already comes to tune how the app judges them. If this route ever
 * narrows to strict credential management, they move rather than go."* It has
 * narrowed, so they moved.
 *
 * The distinction that makes the split worth having: NOTHING HERE IS AN AI
 * SETTING. Every number on this page feeds a TypeScript computation — severity
 * bands, observation floors, targeting order, study scope. The AI never
 * computes mastery; it only reads it. Filing them beside provider keys implied
 * a relationship that does not exist.
 */
export default async function StudySettingsPage() {
  const session = await auth()
  if (!session) return notFound()

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader
        title="Study settings"
        lede={<>
          How answers are scored and what gets put in front of you next. These are
          TypeScript computations, not AI behaviour &mdash; provider keys live under{' '}
          <Link href="/settings/ai" className="underline underline-offset-4 hover:text-foreground">
            AI settings
          </Link>
          .
        </>}
      />

      <SeverityBandPanel />
      <MetricThresholdPanel />
      <TargetingStrategyPanel />
      <StudyScopePanel />
    </div>
  )
}
