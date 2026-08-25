'use server';

import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { summarizeKltsForCards } from '@/lib/klt/summarize';
import type { ActionResult } from '@/types/action';

/** Owner-triggered retry from the set builder. */
export async function retryKltSummarization(cardId: string): Promise<ActionResult<null>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { success: false, error: 'Not signed in' };

  const card = await prisma.card.findFirst({
    where: { id: cardId, set: { userId } },
    select: { id: true, set: { select: { id: true } } },
  });
  if (!card) return { success: false, error: 'Not found' };

  await summarizeKltsForCards(userId, [cardId]);
  revalidatePath(`/sets/${card.set.id}/edit`);
  return { success: true, data: null };
}
