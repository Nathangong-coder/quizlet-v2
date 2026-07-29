"use server";

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { generateJson, AiGenerationError } from '@/lib/ai/generate';
import { AUTOCOMPLETE_PROMPT } from '@/lib/ai/prompts/registry';
import { CardAutocompleteSchema } from '@/lib/ai/schemas';
import { ActionResult } from '@/types/action';

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

    const prompt = AUTOCOMPLETE_PROMPT.build({ set, currentText, side, categories });
    const result = await generateJson({
      userId: session.user.id,
      task: 'autocomplete',
      prompt,
      schema: CardAutocompleteSchema,
    });

    return { success: true, data: result };
  } catch (err) {
    if (err instanceof AiGenerationError) {
      return { success: false, error: err.detail.title, detail: err.detail };
    }
    console.error('Autocomplete error:', err);
    return { success: false, error: 'Failed to get suggestions.' };
  }
}
