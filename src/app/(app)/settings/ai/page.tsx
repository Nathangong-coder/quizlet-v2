import { auth } from '@/auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import CredentialList from '@/components/settings/CredentialList';
import TaskRoutingPanel from '@/components/settings/TaskRoutingPanel';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Provider credentials and task routing. NOTHING ELSE.
 *
 * This page used to also carry the four scoring panels — severity bands, metric
 * thresholds, targeting strategy, study scope — under a comment saying they
 * lived here "because this is where the learner already comes to tune how the
 * app judges them", and that they would move if the route ever narrowed to
 * strict credential management. It has, and they did: `/settings/study`.
 *
 * The URL is deliberately UNCHANGED. Eight links point here from error states
 * across the app — the quiz's no-credentials screen, StudyNext, ScopeLine,
 * /account, /profile/learner and the credential components — and every one of
 * them is about credentials specifically. They all still land correctly, with
 * no redirect to maintain.
 */
export default async function AiSettingsPage() {
  const session = await auth();
  if (!session) {
    return notFound();
  }

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader
        title="AI settings"
        lede="The provider credentials used for grading, distractor generation, training plans, card autocomplete/autofill, and study-note analysis. Add as many as you like across providers; primaries are tried first and backups cover a failure."
      />

      <CredentialList />

      <TaskRoutingPanel />

      <p className="text-sm text-muted-foreground">
        Looking for severity bands, thresholds or targeting? Those govern numbers computed in
        TypeScript rather than anything the AI does, and they now live under{' '}
        <Link href="/settings/study" className="underline underline-offset-4 hover:text-foreground">
          Study settings
        </Link>
        .
      </p>
    </div>
  );
}
