import { auth } from '@/auth';
import { notFound } from 'next/navigation';
import CredentialList from '@/components/settings/CredentialList';
import TaskRoutingPanel from '@/components/settings/TaskRoutingPanel';
import SeverityBandPanel from '@/components/settings/SeverityBandPanel';
import TargetingStrategyPanel from '@/components/settings/TargetingStrategyPanel';
import MetricThresholdPanel from '@/components/settings/MetricThresholdPanel';

export default async function AiSettingsPage() {
  const session = await auth();
  if (!session) {
    return notFound();
  }

  return (
    <div className="container mx-auto py-10 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Settings</h1>
        <p className="text-muted-foreground">
          Manage the AI provider credentials used for quiz grading, distractor generation, training plans, and
          autocomplete. Add as many as you like across providers; primary credentials are tried first, backups
          are used if a primary fails.
        </p>
      </div>

      <CredentialList />

      <TaskRoutingPanel />

      {/*
        Scoring and targeting. These govern TypeScript-computed numbers rather
        than AI behaviour — they live here because this is where the learner
        already comes to tune how the app judges them. If this route ever
        narrows to strict credential management, they move rather than go.
      */}
      <SeverityBandPanel />

      <MetricThresholdPanel />

      <TargetingStrategyPanel />
    </div>
  );
}
