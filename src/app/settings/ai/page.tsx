import { auth } from '@/auth';
import { notFound } from 'next/navigation';
import CredentialList from '@/components/settings/CredentialList';
import TaskRoutingPanel from '@/components/settings/TaskRoutingPanel';

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
    </div>
  );
}
