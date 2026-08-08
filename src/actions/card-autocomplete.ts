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
    // Owner-scoped, NOT readable-scoped, and previously unscoped entirely.
    //
    // This is an authoring aid: its output is only useful while editing, and
    // editing is owner-only. Granting it to readers of a link-shared set would
    // let anyone with a link spend their own AI budget having a model
    // paraphrase someone else's cards, for no legitimate purpose. So unlike
    // every other set read in this codebase, visibility does NOT widen it.
    const set = await prisma.set.findFirst({
      where: { id: setId, userId: session.user.id },
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
