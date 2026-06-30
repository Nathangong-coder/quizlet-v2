"use server";

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { generateJsonWithGoogle } from '@/lib/ai/google';
import { buildAutocompletePrompt } from '@/lib/ai/prompts';
import { CardAutocompleteSchema } from '@/lib/ai/schemas';
import { z } from 'zod';

type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function getCardAutocompleteSuggestions(
  setId: string,
  currentText: string,
  side: 'term' | 'definition',
  categories: string[]
): Promise<ActionResult<{ suggestions: string[] }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const set = await prisma.set.findUnique({
      where: { id: setId },
      include: { cards: true },
    });
    if (!set) return { success: false, error: 'Set not found' };

    const credential = await prisma.aiCredential.findUnique({
      where: { userId: session.user.id },
    });
    if (!credential) return { success: false, error: 'No Google API key saved. Please add it in settings.' };

    const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
    const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);

    const prompt = buildAutocompletePrompt(set, currentText, side, categories);
    const result = await generateJsonWithGoogle({
      apiKey,
      prompt,
      schema: CardAutocompleteSchema,
      model: 'gemini-3-flash',
    });

    return { success: true, data: result };
  } catch (error: any) {
    console.error('Autocomplete error:', error);
    return { success: false, error: 'Failed to get suggestions.' };
  }
}
