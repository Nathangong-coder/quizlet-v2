"use server";

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { generateJson, AiGenerationError } from '@/lib/ai/generate';
import { AUTOCOMPLETE_PROMPT, CARD_AUTOFILL_PROMPT } from '@/lib/ai/prompts/registry';
import { CardAutocompleteSchema, CardAutofillSchema, type CardAutofill } from '@/lib/ai/schemas';
import { ActionResult } from '@/types/action';

async function loadAuthoringSet(setId: string, userId: string) {
  // A new set has no database id yet. It can still use the authoring assistant
  // with generic context plus the side text supplied by the editor.
  if (setId === 'new') {
    return { title: 'New study set', description: null, cards: [] };
  }

  return prisma.set.findFirst({
    where: { id: setId, userId },
    include: { cards: true },
  });
}

export async function getCardAutocompleteSuggestions(
  setId: string,
  currentText: string,
  side: 'term' | 'definition',
  categories: string[],
  referenceText = '',
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
    const set = await loadAuthoringSet(setId, session.user.id);
    if (!set) return { success: false, error: 'Set not found' };

    const prompt = AUTOCOMPLETE_PROMPT.build({ set, currentText, side, categories, referenceText });
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

export async function generateCardAutofill(
  setId: string,
  term: string,
  definition: string,
  categories: string[],
): Promise<ActionResult<CardAutofill>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const set = await loadAuthoringSet(setId, session.user.id);
    if (!set) return { success: false, error: 'Set not found' };

    const prompt = CARD_AUTOFILL_PROMPT.build({ set, term, definition, categories });
    const result = await generateJson({
      userId: session.user.id,
      task: 'autocomplete',
      prompt,
      schema: CardAutofillSchema,
    });

    return { success: true, data: result };
  } catch (err) {
    if (err instanceof AiGenerationError) {
      return { success: false, error: err.detail.title, detail: err.detail };
    }
    console.error('Card autofill error:', err);
    return { success: false, error: 'Failed to generate this card.' };
  }
}
