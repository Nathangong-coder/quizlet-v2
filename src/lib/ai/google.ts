import 'server-only';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { DEFAULT_AI_MODEL, MODEL_FALLBACKS, AiModel } from './model-routing';

export class AiError extends Error {
  constructor(public code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiError';
  }
}

export type AiErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'ai_generation_failed'
  | 'ai_response_invalid';

interface GenerateParams<T> {
  apiKey: string;
  prompt: string;
  schema: z.ZodSchema<T>;
  model?: AiModel;
}

/**
 * Generates a validated JSON response using Google Gemini.
 * Tries models in MODEL_FALLBACKS order if the specified model fails.
 */
export async function generateJsonWithGoogle<T>({
  apiKey,
  prompt,
  schema,
  model = DEFAULT_AI_MODEL,
}: GenerateParams<T>): Promise<T> {
  const genAI = new GoogleGenerativeAI(apiKey);

  // Determine which models to try
  const modelsToTry = [
    model,
    ...MODEL_FALLBACKS.filter(m => m !== model)
  ];

  let lastError: any;

  for (const currentModel of modelsToTry) {
    try {
      const modelInstance = genAI.getGenerativeModel({
        model: currentModel,
        generationConfig: {
          responseMimeType: 'application/json',
        }
      });

      const result = await modelInstance.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      if (!text) {
        throw new Error('Empty response from AI');
      }

      const json = JSON.parse(text);
      return schema.parse(json);

    } catch (error: any) {
      lastError = error;

      // If it's an API key error, stop trying other models
      if (error.message?.includes('API key not valid') || error.status === 403) {
        throw new AiError('invalid_api_key', 'The provided Google API key is invalid.');
      }

      // Log failure for this model and continue to fallback
      console.error(`AI generation failed for model ${currentModel}:`, error.message);
    }
  }

  // All models failed
  if (lastError instanceof z.ZodError) {
    throw new AiError('ai_response_invalid', 'The AI response did not match the expected schema.');
  }

  throw new AiError('ai_generation_failed', `AI generation failed after trying all fallbacks. Last error: ${lastError?.message}`);
}
