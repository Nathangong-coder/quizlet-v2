import { describe, it, expect } from 'vitest';
import { parseModelList } from '@/lib/ai/model-catalog';

describe('parseModelList', () => {
  it('reads Google ListModels and keeps only generateContent-capable ids', () => {
    const json = {
      models: [
        { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
    };
    expect(parseModelList('google', json)).toEqual(['gemini-3.6-flash']);
  });

  it('reads the OpenAI/OpenRouter data array', () => {
    const json = { data: [{ id: 'gpt-5' }, { id: 'o4-mini' }] };
    expect(parseModelList('openai', json)).toEqual(['gpt-5', 'o4-mini']);
    expect(parseModelList('openrouter', json)).toEqual(['gpt-5', 'o4-mini']);
  });

  it('reads the Anthropic data array', () => {
    expect(parseModelList('anthropic', { data: [{ id: 'claude-sonnet-4-5' }] }))
      .toEqual(['claude-sonnet-4-5']);
  });

  it('returns an empty list for an unrecognised payload rather than throwing', () => {
    // A custom endpoint may not implement /models at all; the picker must
    // degrade to free-text entry instead of erroring.
    expect(parseModelList('custom', { unexpected: true })).toEqual([]);
    expect(parseModelList('custom', null)).toEqual([]);
  });
});
