'use server';

import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { generateJson, AiGenerationError } from '@/lib/ai/generate';
import { EXTRACT_KLPS_PROMPT } from '@/lib/ai/prompts/extract-klps';
import { KlpExtractionSchema } from '@/lib/ai/schemas';
import { klpSourceHash } from '@/lib/cards/klp-hash';
import { selectStaleCardIds } from '@/lib/cards/stale';
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
 * OWNER-SCOPED. `userId` is not just the credential pool to bill — it is the
 * authorization boundary. Callers reach this with a client-supplied cardId
 * (`ensureKlpsReady` from the quiz actions), so an unscoped `findMany` here
 * let an authenticated user read another account's card content AND write to
 * their data: `writeKlpVersion` supersedes the victim's live CardKlp rows and
 * mutates Card.klpStatus/klpVersion/klpSourceHash. Cards that don't belong to
 * `userId` are simply not returned by the query, so they are never extracted.
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
      where: { id: { in: cardIds }, set: { userId } },
      include: { contentBlocks: true, set: { select: { title: true } } },
    });
  } catch (err) {
    // Can't even load the cards (e.g. DB unreachable) — nothing to batch, but
    // still must not throw. Best-effort mark the requested ids failed, owner-
    // scoped: `cardIds` is caller-supplied and unverified on this path.
    await markFailed(cardIds, err, 'failed', userId);
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
async function markFailed(
  ids: string[],
  err: unknown,
  status: 'failed' | 'skipped' = 'failed',
  userId?: string,
) {
  try {
    await prisma.card.updateMany({
      where: { id: { in: ids }, ...(userId ? { set: { userId } } : {}) },
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

    // Each write is isolated. Letting a throw propagate abandoned every
    // later entry in the batch, which the caller then marked 'failed' — even
    // though the AI had already returned valid KLPs for them in this same
    // response, so the user pays for that generation twice.
    try {
      await writeKlpVersion(
        card.id,
        entry.klps.map((k) => ({
          text: k.text,
          weight: k.weight,
          kind: k.kind,
          source: 'ai',
          promptVersion: EXTRACT_KLPS_PROMPT.version,
        })),
        hash,
      );
      succeeded.push(card.id);
    } catch (err) {
      await markFailed([card.id], err);
    }
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

/** One KLP row as handed to the versioned writer. */
interface KlpRowInput {
  text: string;
  weight: number;
  kind: string;
  /** 'ai' for extraction, 'user' for a hand-corrected point. */
  source: string;
  promptVersion: number;
}

/**
 * Reads the next version and commits the new KLP rows for one card,
 * atomically.
 *
 * THE ONLY MUTATION PATH FOR CardKlp. AI extraction and user edits both come
 * through here, so `CardKlp` stays append-only: historical
 * `QuizQuestion.targetKlpIds` must keep pointing at rows whose text is what
 * the question was actually built from. An in-place `update` anywhere else
 * silently rewrites history.
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
  cardId: string,
  klps: KlpRowInput[],
  hash: string,
  retried = false,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const { _max } = await tx.cardKlp.aggregate({
        where: { cardId },
        _max: { version: true },
      });
      const version = (_max.version ?? 0) + 1;

      await tx.cardKlp.updateMany({
        where: { cardId, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      await tx.cardKlp.createMany({
        data: klps.map((k, index) => ({
          cardId,
          version,
          index,
          text: k.text,
          weight: k.weight,
          kind: k.kind,
          sourceHash: hash,
          promptVersion: k.promptVersion,
          source: k.source,
        })),
      });
      await tx.card.update({
        where: { id: cardId },
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
      return writeKlpVersion(cardId, klps, hash, true);
    }
    throw err;
  }
}

/**
 * In-flight inline extractions, keyed by user+card.
 *
 * `MultipleChoiceQuiz` fans `getOrGenerateMultipleChoiceOptions` out over every
 * card with `Promise.all`, and each of those now calls `ensureKlpsReady`. On a
 * freshly-imported set whose background extraction hasn't landed, one click
 * would otherwise fire up to 2N concurrent AI calls (N extraction + N
 * generation) against the user's own rate-limited credential pool.
 *
 * This dedupes only WITHIN ONE SERVER INSTANCE — two serverless instances
 * handling the same user's fan-out can still each extract once. That is
 * accepted: `writeKlpVersion`'s P2002 retry already makes the concurrent write
 * safe, and the goal here is just to collapse the obvious same-request storm,
 * not to build a distributed lock.
 */
const inFlightExtractions = new Map<string, Promise<void>>();

function extractOnce(userId: string, cardId: string): Promise<void> {
  const key = `${userId}:${cardId}`;
  const pending = inFlightExtractions.get(key);
  if (pending) return pending;

  const promise = extractKlpsForCards(userId, [cardId]).finally(() => {
    inFlightExtractions.delete(key);
  });
  inFlightExtractions.set(key, promise);
  return promise;
}

/**
 * The live KLPs for one card, extracting inline if they are missing OR stale.
 *
 * This is the self-healing layer: `after()` extraction is fire-and-forget, so
 * a quiz can reach a card whose extraction is still pending, failed, or —
 * because the `after()` callback for an edit was dropped — attached to
 * pre-edit content. Returning on `existing.length > 0` alone served those
 * pre-edit KLPs forever, so distractors corrupted propositions the card no
 * longer teaches (see the doc comment on `klpSourceHash`). Blocks that one
 * question rather than the whole quiz, and returns [] if extraction is
 * impossible so callers fall back to the legacy no-KLP path.
 */
export async function ensureKlpsReady(userId: string, cardId: string): Promise<ReadyKlp[]> {
  const live = () =>
    prisma.cardKlp.findMany({
      where: { cardId, supersededAt: null },
      orderBy: { index: 'asc' },
      select: { id: true, index: true, text: true, weight: true, kind: true },
    });

  const existing = await live();

  // Owner-scoped: this decides whether to run an AI call and a write on the
  // card, so it must not act on a card the caller does not own.
  const card = await prisma.card.findFirst({
    where: { id: cardId, set: { userId } },
    select: {
      id: true,
      term: true,
      definition: true,
      klpStatus: true,
      klpSourceHash: true,
      contentBlocks: {
        select: { side: true, type: true, text: true, assetId: true, position: true },
      },
    },
  });
  if (!card) return [];

  // Same pure predicate the save path uses — one definition of "stale".
  const isStale = selectStaleCardIds([card]).length > 0;
  if (existing.length > 0 && !isStale) return existing;

  // 'skipped' means the user has no key. Retrying per question would fire one
  // doomed call per card in the quiz. Serve whatever exists (possibly stale —
  // there is no way to refresh it) rather than nothing.
  if (card.klpStatus === 'skipped') return existing;

  await extractOnce(userId, cardId);
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
 * Corrects one KLP by writing a NEW version of the card's KLP set.
 *
 * NOT an in-place update. `QuizQuestion.targetKlpIds` rows already in the
 * database name specific CardKlp ids as the provenance of questions already
 * asked; rewriting one of those rows' text retroactively changes what a past
 * question is recorded as having tested. So the whole live set is superseded
 * and re-written at version n+1: the edited point carries `source: 'user'`,
 * and every untouched point is copied forward unchanged, keeping its ORIGINAL
 * `source` (an AI-extracted point that was merely carried along is still
 * AI-extracted).
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

  // `supersededAt: null` — a superseded row is history and must not be
  // editable through the public action.
  const klp = await prisma.cardKlp.findFirst({
    where: { id: klpId, supersededAt: null, card: { set: { userId: session.user.id } } },
    include: { card: { include: { contentBlocks: true } } },
  });
  if (!klp) return { success: false, error: 'Not found' };

  const liveKlps = await prisma.cardKlp.findMany({
    where: { cardId: klp.cardId, supersededAt: null },
    orderBy: { index: 'asc' },
  });

  const rows: KlpRowInput[] = liveKlps.map((k) =>
    k.id === klpId
      ? {
          text: patch.text,
          weight: patch.weight,
          kind: patch.kind,
          source: 'user',
          promptVersion: k.promptVersion,
        }
      : {
          text: k.text,
          weight: k.weight,
          kind: k.kind,
          source: k.source,
          promptVersion: k.promptVersion,
        },
  );

  const hash = klpSourceHash({
    term: klp.card.term,
    definition: klp.card.definition,
    blocks: klp.card.contentBlocks,
  });

  try {
    await writeKlpVersion(klp.cardId, rows, hash);
  } catch (err) {
    console.error('saveCardKlp version write failed:', err);
    return { success: false, error: 'Failed to save' };
  }

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
