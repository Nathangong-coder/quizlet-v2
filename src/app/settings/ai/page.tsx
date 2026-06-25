import { auth } from '@/auth';
import { getGoogleApiKeyStatus } from '@/actions/ai-settings';
import { GoogleApiKeyForm } from '@/components/settings/GoogleApiKeyForm';
import { notFound } from 'next/navigation';

export default async function AiSettingsPage() {
  const session = await auth();
  if (!session) {
    return notFound();
  }

  const result = await getGoogleApiKeyStatus();
  const initialKeyHint = result.success ? result.data?.keyHint || null : null;

  return (
    <div className="container mx-auto py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Settings</h1>
        <p className="text-muted-foreground">
          Manage your Google API key for AI-powered features like quiz grading and question generation.
        </p>
      </div>

      <div className="grid gap-6">
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Google API Key</h2>
          <p className="text-sm text-muted-foreground">
            Your API key is used locally by the server to make calls to Google Gemini models on your behalf.
            It is encrypted before being stored in our database.
          </p>
          <GoogleApiKeyForm initialKeyHint={initialKeyHint} />
        </section>
      </div>
    </div>
  );
}
