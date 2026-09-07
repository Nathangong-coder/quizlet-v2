import { createGoogle } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export const AI_PROVIDERS = ['google', 'anthropic', 'openai', 'openrouter', 'deepseek', 'custom'] as const;
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
  deepseek: {
    label: 'DeepSeek',
    requiresBaseUrl: false,
    defaultModel: 'deepseek-v4-flash',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    keyPlaceholder: 'sk-…',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    requiresBaseUrl: true,
    // Intentionally empty: no model id is valid across arbitrary
    // OpenAI-compatible backends (Ollama, vLLM, LM Studio, self-hosted
    // gateways, ...), so the user must explicitly choose one rather than
    // silently receiving a guessed default that may not exist on their host.
    defaultModel: '',
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
    case 'deepseek': {
      // DEEPSEEK NEEDS THE RESPONSES API, not chat/completions.
      //
      // `/v1/chat/completions` answers a JSON-schema request with
      // "This response_format type is unavailable now" — it supports
      // `json_object` only. `/v1/responses` supports the full contract via
      // `text.format: { type: 'json_schema', name, schema }`. Measured
      // 2026-09-06; both `deepseek-v4-flash` and `deepseek-v4-pro` pass there
      // and neither passes on chat/completions. Routing this through
      // `createOpenAICompatible` (as `custom` does) would silently land on the
      // wrong endpoint and look like a bad model.
      return createOpenAI({
        apiKey,
        baseURL: baseUrl?.trim() || PROVIDER_META.deepseek.defaultBaseUrl,
        fetch: deepSeekFetch,
      }).responses(model);
    }
    case 'openrouter':
    case 'custom': {
      const url = baseUrl?.trim();
      if (!url) {
        throw new ProviderConfigError(
          `${PROVIDER_META[provider].label} needs a base URL. Add one in AI settings.`,
        );
      }
      // `supportsStructuredOutputs` DEFAULTS TO FALSE in the SDK, and when it
      // is false the JSON schema is silently DROPPED from the request - the
      // model is asked for "some JSON" with no shape, returns free-form
      // output, and Zod rejects it. That surfaces as `schema_invalid`, which
      // reads as "this model is bad at schemas" rather than "we never sent it
      // one". Measured 2026-09-06 on minimax via OpenRouter: the SDK logged
      // `The feature "responseFormat" is not supported` and the probe failed.
      //
      // Every generation in this app goes through `Output.object({ schema })`,
      // so a provider that genuinely cannot do structured output cannot serve
      // it at all. Sending the schema makes that failure EXPLICIT — an API
      // error naming the unsupported feature — instead of silently producing
      // unparseable text that looks like a model quality problem.
      return createOpenAICompatible({
        name: provider,
        apiKey,
        baseURL: url,
        supportsStructuredOutputs: true,
      })(model);
    }
    default:
      throw new ProviderConfigError(`Unknown AI provider: ${String(provider)}`);
  }
}

/**
 * Turns DeepSeek's reasoning OFF, and does it by rewriting the request body
 * because the AI SDK will not send the field.
 *
 * WHY NOT `providerOptions.openai.reasoningEffort`: the SDK decides whether a
 * model accepts that option from a hard-coded list of OpenAI model ids. For
 * `deepseek-v4-flash` it strips the field and logs "reasoningEffort is not
 * supported for non-reasoning models". An earlier benchmark measured three
 * conditions that were byte-identical because of exactly this.
 *
 * WHY TURN IT OFF AT ALL — measured on the grading task, 5 samples per
 * condition, all correct in every condition:
 *
 *   reasoning on    9.4s (6.1-13.0)   1,168 output tokens (943 reasoning)
 *   effort 'none'   2.0s (2.0-2.1)      296 output tokens (0 reasoning)
 *
 * A 4.7x speedup and ~4x fewer output tokens for no measured loss in verdict
 * quality — and latency becomes DETERMINISTIC, because the variance was
 * entirely reasoning length. Grading an answer against one stated proposition
 * has nothing to reason about: the claim is in the text or it is not.
 *
 * Note `effort: 'minimal'` does NOT disable thinking (still 541-810 reasoning
 * tokens). Only `'none'` does. See docs/ai/model-performance.md.
 */
const deepSeekFetch: typeof fetch = async (input, init) => {
  if (!init?.body || typeof init.body !== 'string') return fetch(input, init);
  try {
    const body = JSON.parse(init.body) as Record<string, unknown>;

    // Never override a caller that asked for reasoning explicitly.
    if (body.reasoning === undefined) body.reasoning = { effort: 'none' };

    // STRICT OFF, for now, and this is a schema limitation rather than a
    // preference. Provider strict mode requires every property to appear in
    // `required` — DeepSeek rejects anything else with "Required properties
    // must match all properties in the object" — and this app's schemas use
    // `.optional()` throughout (`mistake?`, `klpResults?`, `errorTags?`).
    //
    // Worth revisiting: the benchmark found strict costs 0.1s and 15 tokens
    // once reasoning is off, so the conformance guarantee is nearly free. It
    // needs the Zod schemas converted to required-and-`.nullable()` first,
    // which is a separate change. See docs/ai/model-performance.md.
    const text = body.text as { format?: Record<string, unknown> } | undefined;
    if (text?.format?.type === 'json_schema') text.format.strict = false;

    return fetch(input, { ...init, body: JSON.stringify(body) });
  } catch {
    // A body we cannot parse is one we must not corrupt. Pass it through and
    // let the provider reject it with its own error rather than ours.
    return fetch(input, init);
  }
};
