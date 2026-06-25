export const DEFAULT_AI_MODEL = 'gemini-3-flash';

export const MODEL_FALLBACKS = [
  'gemini-3-flash',
  'gemma-4-31b-it',
  'gemini-3.1-flash-lite',
  'gemma-3-27b-it',
  'gemma-3-12b-it',
] as const;

export type AiModel = typeof MODEL_FALLBACKS[number];
