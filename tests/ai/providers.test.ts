import { describe, it, expect } from 'vitest';
import {
  resolveLanguageModel,
  ProviderConfigError,
  PROVIDER_META,
  AI_PROVIDERS,
} from '@/lib/ai/providers';

describe('PROVIDER_META', () => {
  it('describes every supported provider', () => {
    for (const id of AI_PROVIDERS) {
      const meta = PROVIDER_META[id];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(typeof meta.requiresBaseUrl).toBe('boolean');
      expect(meta.defaultModel.length).toBeGreaterThan(0);
    }
  });

  it('requires a base URL only for the openai-compatible providers', () => {
    expect(PROVIDER_META.google.requiresBaseUrl).toBe(false);
    expect(PROVIDER_META.anthropic.requiresBaseUrl).toBe(false);
    expect(PROVIDER_META.openai.requiresBaseUrl).toBe(false);
    expect(PROVIDER_META.openrouter.requiresBaseUrl).toBe(true);
    expect(PROVIDER_META.custom.requiresBaseUrl).toBe(true);
  });

  it('defaults the distractor-safe Google model, since QuizOptionCache is keyed on model id', () => {
    expect(PROVIDER_META.google.defaultModel).toBe('gemini-3.6-flash');
  });
});

describe('resolveLanguageModel', () => {
  it('builds a model for each first-party provider', () => {
    for (const provider of ['google', 'anthropic', 'openai'] as const) {
      const model = resolveLanguageModel({ provider, apiKey: 'k', model: 'some-model' });
      expect(model).toBeDefined();
    }
  });

  it('builds a model for openai-compatible providers given a base URL', () => {
    const model = resolveLanguageModel({
      provider: 'openrouter',
      apiKey: 'k',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4',
    });
    expect(model).toBeDefined();
  });

  it('throws rather than building a half-configured client when baseUrl is missing', () => {
    // Silently defaulting the URL would send the key to the wrong host.
    expect(() => resolveLanguageModel({ provider: 'custom', apiKey: 'k', model: 'm' }))
      .toThrow(ProviderConfigError);
    expect(() => resolveLanguageModel({ provider: 'openrouter', apiKey: 'k', baseUrl: '  ', model: 'm' }))
      .toThrow(ProviderConfigError);
  });

  it('throws on an unknown provider id', () => {
    expect(() =>
      // @ts-expect-error deliberately invalid
      resolveLanguageModel({ provider: 'nope', apiKey: 'k', model: 'm' }),
    ).toThrow(ProviderConfigError);
  });
});
