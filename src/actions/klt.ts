'use server';

import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { generateJson, AiGenerationError } from '@/lib/ai/generate';
import { SUMMARIZE_KLTS_PROMPT } from '@/lib/ai/prompts/summarize-klts';
import { KltSummarySchema } from '@/lib/ai/schemas';
import { KLT_BATCH_SIZE } from '@/lib/cards/klt-batch';
import { assembleCandidates } from '@/lib/klt/candidates';
import { resolveKltWrites, type KltWrite } from '@/lib/klt/resolve';
import type { CardKlpStatus, CardKlpFailureStatus } from '@/lib/cards/klp-status';
import { readableSetWhere } from '@/lib/sets/visibility';
import type { ActionResult } from '@/types/action';

/**
 * Same rule as KLP extraction: an AiGenerationError carrying zero attempts
 * means the candidate pool was empty, which is not a broken summarization.
 */
function isNoUsableCredential(err: unknown): boolean {
  return err instanceof AiGenerationError && (err.detail.attempts?.length ?? 0) === 0;
}

interface BatchCard {
  id: string;
  set: { id: string; title: string };
  klps: { id: string; text: string; kind: string }[];
}

/**
 * Summarizes each card's live KLPs into a short `label` plus 1-3 topics.
 *
 * OWNER-SCOPED and NEVER THROWS, for the same reasons as
 * `extractKlpsForCards` — it runs inside `after()`, where an exception
 * surfaces as an unhandled rejection long after the user's response went out.
 * Every failure is recorded on the card instead.
 *
 * SAFETY (spec §6). This function writes exactly three things:
 *   - `CardKlp.label`, in place;
 *   - `Klt` rows, via upsert;
 *   - `KlpTopic` rows.
 * It issues NO delete and NO `supersededAt` write against `CardKlp`, and never
 * touches `KlpState` or `AnswerKlpResult`. Superseding a row to attach a label
 * would mint new `klpId`s and orphan every accumulated BKT posterior and every
 * answer result keyed on the old ones — a silent, total mastery reset,
 * invisible to `tsc` and to any test that only checks the label landed.
 */
export async function summarizeKltsForCards(
  userId: string,
  cardIds: string[],
  isOwner: boolean = true,
): Promise<void> {
  if (cardIds.length === 0) return;

  let cards: BatchCard[];
  try {
    cards = await prisma.card.findMany({
      where: { id: { in: cardIds }, set: readableSetWhere(userId) },
      select: {
        id: true,
        set: { select: { id: true, title: true } },
        klps: {
          where: { supersededAt: null },
          orderBy: { index: 'asc' },
          select: { id: true, text: true, kind: true },
        },
      },
    });
  } catch (err) {
    // Can't even load the cards — still must not throw. Owner-scoped, because
    // `cardIds` is caller-supplied and unverified on this path.
    if (isOwner) await markKltFailed(cardIds, err, 'failed', userId);
    return;
  }

  // A card with no live KLPs has nothing to summarize. Left at its current
  // status rather than marked ready: extraction may still be in flight.
  const withKlps = cards.filter((c) => c.klps.length > 0);

  for (let i = 0; i < withKlps.length; i += KLT_BATCH_SIZE) {
    const batch = withKlps.slice(i, i + KLT_BATCH_SIZE);
    // Owned by the caller so it survives the throw: `summarizeOneBatch`
    // commits one card at a time, and a later entry failing must not clobber
    // the rows earlier entries already committed.
    const succeeded: string[] = [];
    try {
      await summarizeOneBatch(userId, batch, succeeded);
    } catch (err) {
      const failedIds = batch.map((c) => c.id).filter((id) => !succeeded.includes(id));
      if (failedIds.length > 0 && isOwner) {
        await markKltFailed(failedIds, err, isNoUsableCredential(err) ? 'skipped' : 'failed');
      }
    }
  }
}

async function summarizeOneBatch(
  userId: string,
  batch: BatchCard[],
  succeeded: string[],
): Promise<void> {
  // One flat list of KLPs across the whole batch; `ref` indexes into it.
  const flat = batch.flatMap((card) => card.klps.map((k) => ({ ...k, cardId: card.id })));
  const klpIds = flat.map((k) => k.id);

  const setId = batch[0].set.id;
  const [setLocalRows, existing] = await Promise.all([
    prisma.klt.findMany({
      where: { links: { some: { klp: { card: { setId }, supersededAt: null } } } },
      select: { normalizedName: true },
    }),
    prisma.klt.findMany({
      select: { name: true, normalizedName: true, _count: { select: { links: true } } },
    }),
  ]);

  const candidates = assembleCandidates({
    setLocal: setLocalRows.map((r) => r.normalizedName),
    existing: existing.map((e) => ({
      name: e.name,
      normalizedName: e.normalizedName,
      linkCount: e._count.links,
    })),
    klpTexts: flat.map((k) => k.text),
  });

  const result = await generateJson({
    userId,
    task: 'autocomplete',
    prompt: SUMMARIZE_KLTS_PROMPT.build({
      setTitle: batch[0].set.title,
      klps: flat.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
      candidates,
    }),
    schema: KltSummarySchema,
  });

  const writes = resolveKltWrites(result.klps, klpIds);
  const byCard = new Map<string, KltWrite[]>();
  for (const write of writes) {
    const cardId = flat.find((k) => k.id === write.klpId)?.cardId;
    if (cardId === undefined) continue;
    const list = byCard.get(cardId);
    if (list) list.push(write);
    else byCard.set(cardId, [write]);
  }

  // Each card commits independently, so one bad card does not abandon results
  // the AI already returned — and the user already paid for — for the rest of
  // the batch. Same reasoning as `extractOneBatch`'s per-entry try.
  for (const card of batch) {
    try {
      await applyKltWrites(card.id, byCard.get(card.id) ?? []);
      succeeded.push(card.id);
    } catch (err) {
      await markKltFailed([card.id], err);
    }
  }
}

/**
 * Commit one card's summary.
 *
 * The `Klt` upserts run BEFORE the transaction on purpose. They are global
 * rows shared with every other account, so holding them inside a per-card
 * transaction would serialize unrelated users on the popular topics.
 *
 * `upsert`, never `create`: `normalizedName` is globally unique, and two
 * concurrent batches minting the same topic must converge on one row rather
 * than one of them dying on a P2002.
 */
async function applyKltWrites(cardId: string, writes: KltWrite[]): Promise<void> {
  const allTopics = writes.flatMap((w) => w.topics);
  const kltIds = new Map<string, string>();
  for (const topic of allTopics) {
    if (kltIds.has(topic.normalizedName)) continue;
    const row = await prisma.klt.upsert({
      where: { normalizedName: topic.normalizedName },
      create: { name: topic.name, normalizedName: topic.normalizedName },
      // Deliberately empty: the FIRST spelling wins for display. Letting a
      // later batch rewrite `name` would make the label flicker between
      // accounts for no gain, since `normalizedName` is the identity anyway.
      update: {},
      select: { id: true },
    });
    kltIds.set(topic.normalizedName, row.id);
  }

  await prisma.$transaction(async (tx) => {
    for (const write of writes) {
      // `label` is the ONLY column a writer other than `writeKlpVersion` may
      // touch — see that function's doc comment and spec §6.1.
      await tx.cardKlp.update({
        where: { id: write.klpId },
        data: { label: write.label },
      });
      // Replace this KLP's links rather than adding to them, so a retry or a
      // backfill re-run is idempotent instead of accumulating duplicates.
      await tx.klpTopic.deleteMany({ where: { klpId: write.klpId } });
      const rows = write.topics
        .map((t) => ({ klpId: write.klpId, kltId: kltIds.get(t.normalizedName), rank: t.rank }))
        .filter((r): r is { klpId: string; kltId: string; rank: number } => r.kltId !== undefined);
      if (rows.length > 0) await tx.klpTopic.createMany({ data: rows });
    }

    await tx.card.update({
      where: { id: cardId },
      data: { kltStatus: 'ready' satisfies CardKlpStatus, kltError: null },
    });
  });
}

/**
 * Records a batch failure on its cards. Swallows its own write error — if even
 * this fails there is nothing further to do, and it must still not throw.
 */
async function markKltFailed(
  ids: string[],
  err: unknown,
  status: CardKlpFailureStatus = 'failed',
  userId?: string,
): Promise<void> {
  try {
    await prisma.card.updateMany({
      where: { id: { in: ids }, ...(userId ? { set: { userId } } : {}) },
      data: {
        kltStatus: status,
        kltError: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
      },
    });
  } catch {
    // Nothing more to do — see the doc comment above.
  }
}

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
