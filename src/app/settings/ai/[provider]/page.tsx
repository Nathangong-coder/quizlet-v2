import { auth } from '@/auth';
import { notFound } from 'next/navigation';
import { AI_PROVIDERS, type ProviderId } from '@/lib/ai/providers';
import { listCredentials } from '@/actions/ai-credentials';
import CredentialForm from '@/components/settings/CredentialForm';

function isProviderId(value: string): value is ProviderId {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export default async function ProviderCredentialPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await auth();
  if (!session) return notFound();

  const { provider } = await params;
  if (!isProviderId(provider)) return notFound();

  const { id } = await searchParams;

  let credential = null;
  if (id) {
    const result = await listCredentials();
    if (result.success) {
      credential = result.data.find((c) => c.id === id && c.provider === provider) ?? null;
    }
    if (!credential) return notFound();
  }

  return <CredentialForm provider={provider} credential={credential} />;
}
