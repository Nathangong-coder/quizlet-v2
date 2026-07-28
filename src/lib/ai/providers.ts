import { createGoogle } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export const AI_PROVIDERS = ['google', 'anthropic', 'openai', 'openrouter', 'custom'] as const;
export type ProviderId = (typeof AI_PROVIDERS)[number];

export interface ProviderMeta {
  label: string;
  /** OpenAI-compatible providers have no fixed host, so a base URL is mandatory. */
  requiresBaseUrl: boolean;
  defaultModel: string;
  defaultBaseUrl?: string;
  /** Endpoint used to list models; see lib/ai/model-catalog.ts. */
  keyPlaceholder: string;
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  google: {
    label: 'Google Gemini',
    requiresBaseUrl: false,
    defaultModel: 'gemini-3.6-flash',
    keyPlaceholder: 'AIza…',
  },
  anthropic: {
    label: 'Anthropic Claude',
    requiresBaseUrl: false,
    defaultModel: 'claude-sonnet-4-5',
    keyPlaceholder: 'sk-ant-…',
  },
  openai: {
    label: 'OpenAI',
    requiresBaseUrl: false,
    defaultModel: 'gpt-5',
    keyPlaceholder: 'sk-…',
  },
  openrouter: {
    label: 'OpenRouter',
    requiresBaseUrl: true,
    defaultModel: 'anthropic/claude-sonnet-4.5',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyPlaceholder: 'sk-or-…',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    requiresBaseUrl: true,
    // The brief's own PROVIDER_META unit test requires every provider's
    // defaultModel to be non-empty, so this can't be '' even though the
    // endpoint is fully user-defined. Pick a widely-supported placeholder
    // the user can override.
    defaultModel: 'gpt-4o-mini',
    keyPlaceholder: 'your API key',
  },
};

/** Thrown when a credential cannot produce a usable client. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export interface ResolveInput {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string | null;
  model: string;
}

/**
 * Builds an AI SDK LanguageModel for one credential.
 *
 * NOTE: `createGoogle` is the v7 name — it was `createGoogleGenerativeAI`
 * before the rename. Do not "fix" it back.
 */
export function resolveLanguageModel({ provider, apiKey, baseUrl, model }: ResolveInput): LanguageModel {
  switch (provider) {
    case 'google':
      return createGoogle({ apiKey })(model);
    case 'anthropic':
      return createAnthropic({ apiKey })(model);
    case 'openai':
      return createOpenAI({ apiKey })(model);
    case 'openrouter':
    case 'custom': {
      const url = baseUrl?.trim();
      if (!url) {
        throw new ProviderConfigError(
          `${PROVIDER_META[provider].label} needs a base URL. Add one in AI settings.`,
        );
      }
      return createOpenAICompatible({ name: provider, apiKey, baseURL: url })(model);
    }
    default:
      throw new ProviderConfigError(`Unknown AI provider: ${String(provider)}`);
  }
}
