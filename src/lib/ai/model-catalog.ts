import 'server-only';
import type { ProviderId } from '@/lib/ai/providers';

/**
 * Parses a provider's model-list payload into plain ids.
 *
 * Returns [] on anything unrecognised: a custom OpenAI-compatible endpoint may
 * not implement /models, and the picker must fall back to free-text entry
 * rather than surfacing an error.
 */
export function parseModelList(provider: ProviderId, json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const body = json as Record<string, unknown>;

  if (provider === 'google') {
    const models = Array.isArray(body.models) ? body.models : [];
    return models
      .filter((m): m is { name: string; supportedGenerationMethods?: string[] } =>
        !!m && typeof (m as { name?: unknown }).name === 'string')
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  }

  const data = Array.isArray(body.data) ? body.data : [];
  return data
    .filter((m): m is { id: string } => !!m && typeof (m as { id?: unknown }).id === 'string')
    .map((m) => m.id);
}

const LIST_ENDPOINTS: Record<ProviderId, (key: string, baseUrl?: string | null) => { url: string; headers: Record<string, string> }> = {
  google: (key) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`,
    headers: {},
  }),
  anthropic: (key) => ({
    url: 'https://api.anthropic.com/v1/models?limit=100',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  }),
  openai: (key) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  openrouter: (key, baseUrl) => ({
    url: `${(baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/models`,
    headers: { Authorization: `Bearer ${key}` },
  }),
  custom: (key, baseUrl) => ({
    url: `${(baseUrl ?? '').replace(/\/$/, '')}/models`,
    headers: { Authorization: `Bearer ${key}` },
  }),
};

export async function fetchModelList(
  provider: ProviderId, apiKey: string, baseUrl?: string | null,
): Promise<string[]> {
  const { url, headers } = LIST_ENDPOINTS[provider](apiKey, baseUrl);
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  return parseModelList(provider, await res.json());
}
