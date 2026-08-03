'use server';

import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { generateJson, AiGenerationError } from '@/lib/ai/generate';
import { EXTRACT_KLPS_PROMPT } from '@/lib/ai/prompts/extract-klps';
import { KlpExtractionSchema } from '@/lib/ai/schemas';
import { klpSourceHash } from '@/lib/cards/klp-hash';
import type { ActionResult } from '@/types/action';

/**
 * Cards per extraction call. The pipe/semicolon importer creates 100+ cards in
 * one save; one call per card would exhaust the user's key pool and surface as
 * `quota_exhausted` across their whole account.
 */
export const KLP_BATCH_SIZE = 10;

/**
 * An AiGenerationError carrying zero attempts means the candidate pool was
 * empty — the user has no key saved, or every key is disabled or unroutable
 * for this task. That is not a broken extraction, so the card is marked
 * 'skipped' and the UI offers no retry. A non-empty attempts list means real
 * provider failures, which are worth retrying.
 */
function isNoUsableCredential(err: unknown): boolean {
  return err instanceof AiGenerationError && (err.detail.attempts?.length ?? 0) === 0;
}

export interface ReadyKlp {
  id: string;
  index: number;
  text: string;
  weight: number;
  kind: string;
}

/**
 * Extracts KLPs for the given cards, in batches.
 *
 * NEVER THROWS. It runs inside `after()` on the set-save path, where an
 * exception would surface as an unhandled rejection long after the user's
 * response went out. Every failure is recorded on the card instead.
 */
export async function extractKlpsForCards(userId: string, cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return;

  let cards: BatchCard[];
  try {
    cards = await prisma.card.findMany({
      where: { id: { in: cardIds } },
      include: { contentBlocks: true, set: { select: { title: true } } },
    });
  } catch (err) {
    // Can't even load the cards (e.g. DB unreachable) — nothing to batch, but
    // still must not throw. Best-effort mark the requested ids failed.
    await markFailed(cardIds, err);
    return;
  }

  for (let i = 0; i < cards.length; i += KLP_BATCH_SIZE) {
    const batch = cards.slice(i, i + KLP_BATCH_SIZE);
    // Owned by the caller so it survives the throw: extractOneBatch commits
    // one card at a time, and a later entry failing must not clobber the
    // klpStatus: 'ready' rows earlier entries already committed.
    const succeeded: string[] = [];
    try {
      await extractOneBatch(userId, batch, succeeded);
    } catch (err) {
      const failedIds = batch.map((c) => c.id).filter((id) => !succeeded.includes(id));
      if (failedIds.length > 0) {
        await markFailed(failedIds, err, isNoUsableCredential(err) ? 'skipped' : 'failed');
      }
    }
  }
}

/**
 * Records a batch failure on its cards. Swallows its own write error — if
 * even this fails (e.g. the DB just went down), there is nothing further
 * this function can do, and it must still not throw.
 */
async function markFailed(ids: string[], err: unknown, status: 'failed' | 'skipped' = 'failed') {
  try {
    await prisma.card.updateMany({
      where: { id: { in: ids } },
      data: {
        klpStatus: status,
        klpError: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
      },
    });
  } catch {
    // Nothing more to do — see doc comment above.
  }
}

interface BatchCard {
  id: string;
  term: string;
  definition: string;
  contentBlocks: { side: string; type: string; text: string | null; assetId: string | null; position: number }[];
  set: { title: string };
}

async function extractOneBatch(
  userId: string,
  batch: BatchCard[],
  succeeded: string[],
): Promise<void> {
  const prompt = EXTRACT_KLPS_PROMPT.build({
    setTitle: batch[0].set.title,
    cards: batch.map((c, ref) => ({ ref, term: c.term, definition: c.definition })),
  });

  const result = await generateJson({
    userId,
    task: 'autocomplete',
    prompt,
    schema: KlpExtractionSchema,
  });

  for (const entry of result.cards) {
    const card = batch[entry.ref];
    // A hallucinated ref must not write another card's KLPs onto this one.
    if (!card) continue;

    const hash = klpSourceHash({
      term: card.term,
      definition: card.definition,
      blocks: card.contentBlocks,
    });

    await writeKlpVersion(card, entry.klps, hash);
    succeeded.push(card.id);
  }
}

/** Prisma's unique-constraint violation code. */
const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === UNIQUE_CONSTRAINT_ERROR_CODE
  );
}

/**
 * Reads the next version and commits the new KLP rows for one card,
 * atomically.
 *
 * The version read and the write MUST be in the same transaction: `after()`
 * extraction on set save and `ensureKlpsReady`'s on-demand extraction (Task
 * 6) can both reach the same card concurrently. Reading `_max.version`
 * outside the transaction lets two callers compute the same next version and
 * have the loser die on `@@unique([cardId, version, index])`. On that race,
 * retry once — the retry's read sees the winner's committed version and
 * lands on the next one after it.
 */
async function writeKlpVersion(
  card: BatchCard,
  klps: { text: string; weight: number; kind: string }[],
  hash: string,
  retried = false,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const { _max } = await tx.cardKlp.aggregate({
        where: { cardId: card.id },
        _max: { version: true },
      });
      const version = (_max.version ?? 0) + 1;

      await tx.cardKlp.updateMany({
        where: { cardId: card.id, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      await tx.cardKlp.createMany({
        data: klps.map((k, index) => ({
          cardId: card.id,
          version,
          index,
          text: k.text,
          weight: k.weight,
          kind: k.kind,
          sourceHash: hash,
          promptVersion: EXTRACT_KLPS_PROMPT.version,
          source: 'ai',
        })),
      });
      await tx.card.update({
        where: { id: card.id },
        data: {
          klpStatus: 'ready',
          klpVersion: version,
          klpSourceHash: hash,
          klpError: null,
        },
      });
    });
  } catch (err) {
    if (!retried && isUniqueConstraintError(err)) {
      return writeKlpVersion(card, klps, hash, true);
    }
    throw err;
  }
}

/**
 * The live KLPs for one card, extracting inline if they are missing.
 *
 * This is the self-healing layer: `after()` extraction is fire-and-forget, so
 * a quiz can reach a card whose extraction is still pending or failed. Blocks
 * that one question rather than the whole quiz, and returns [] if extraction
 * is impossible so callers fall back to the legacy no-KLP path.
 */
export async function ensureKlpsReady(userId: string, cardId: string): Promise<ReadyKlp[]> {
  const live = () =>
    prisma.cardKlp.findMany({
      where: { cardId, supersededAt: null },
      orderBy: { index: 'asc' },
      select: { id: true, index: true, text: true, weight: true, kind: true },
    });

  const existing = await live();
  if (existing.length > 0) return existing;

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { klpStatus: true },
  });
  // 'skipped' means the user has no key. Retrying per question would fire one
  // doomed call per card in the quiz.
  if (card?.klpStatus === 'skipped') return [];

  await extractKlpsForCards(userId, [cardId]);
  return live();
}

/**
 * KLPs for one card, for the set builder. Owner-checked: KLP text is derived
 * from card content, so it must not leak across accounts.
 */
export async function getCardKlps(
  cardId: string,
): Promise<ActionResult<{ status: string; klps: ReadyKlp[] }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const card = await prisma.card.findFirst({
    where: { id: cardId, set: { userId: session.user.id } },
    select: { klpStatus: true },
  });
  if (!card) return { success: false, error: 'Card not found' };

  const klps = await prisma.cardKlp.findMany({
    where: { cardId, supersededAt: null },
    orderBy: { index: 'asc' },
    select: { id: true, index: true, text: true, weight: true, kind: true },
  });

  return { success: true, data: { status: card.klpStatus, klps } };
}

/**
 * Corrects one KLP in place, marking it user-authored.
 *
 * Also stamps the card's current content hash so the next save does not treat
 * the card as stale and re-extract over the correction.
 */
export async function saveCardKlp(
  klpId: string,
  patch: { text: string; weight: number; kind: string },
): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const klp = await prisma.cardKlp.findFirst({
    where: { id: klpId, card: { set: { userId: session.user.id } } },
    include: { card: { include: { contentBlocks: true } } },
  });
  if (!klp) return { success: false, error: 'Not found' };

  await prisma.$transaction([
    prisma.cardKlp.update({
      where: { id: klpId },
      data: { text: patch.text, weight: patch.weight, kind: patch.kind, source: 'user' },
    }),
    prisma.card.update({
      where: { id: klp.cardId },
      data: {
        klpSourceHash: klpSourceHash({
          term: klp.card.term,
          definition: klp.card.definition,
          blocks: klp.card.contentBlocks,
        }),
        klpStatus: 'ready',
      },
    }),
  ]);

  revalidatePath(`/sets/${klp.card.setId}/edit`);
  return { success: true, data: undefined };
}

/** Re-runs extraction for one card after a failure. */
export async function retryKlpExtraction(cardId: string): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const card = await prisma.card.findFirst({
    where: { id: cardId, set: { userId: session.user.id } },
    select: { id: true },
  });
  if (!card) return { success: false, error: 'Card not found' };

  await extractKlpsForCards(session.user.id, [cardId]);
  return { success: true, data: undefined };
}
