export const DEFAULT_AI_MODEL = 'gemini-3.1-flash-lite';

export const MODEL_FALLBACKS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemma-4-31b-it',
] as const;

export type AiModel = typeof MODEL_FALLBACKS[number];
