import { prisma } from '@/lib/db';
import type { CardKlpStatus } from '@/lib/cards/klp-status';

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
export interface KlpRowInput {
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
 * THE ONLY MUTATION PATH FOR CardKlp'S PROPOSITION. AI extraction and user
 * edits both come through here, so `CardKlp` stays append-only with respect to
 * MEANING: historical `QuizQuestion.targetKlpIds` must keep pointing at rows
 * whose text is what the question was actually built from. An in-place
 * `update` to `text`, `weight`, `kind`, `index`, `version`, `sourceHash`,
 * `promptVersion`, `source` or `supersededAt` anywhere else silently rewrites
 * history.
 *
 * ONE EXCEPTION, added with the KLT layer (spec §6.1): `label` is a derived
 * display annotation carrying no semantic content, and `src/actions/klt.ts`
 * updates it in place. That cannot rewrite history — the proposition a
 * question was built from is unchanged. It is deliberately NOT routed through
 * here, because superseding a row to attach a label would mint new `klpId`s
 * and orphan every `KlpState` posterior and `AnswerKlpResult` row keyed on the
 * old ones: a silent, total mastery reset.
 *
 * The version read and the write MUST be in the same transaction: `after()`
 * extraction on set save and `ensureKlpsReady`'s on-demand extraction (Task
 * 6) can both reach the same card concurrently. Reading `_max.version`
 * outside the transaction lets two callers compute the same next version and
 * have the loser die on `@@unique([cardId, version, index])`. On that race,
 * retry once — the retry's read sees the winner's committed version and
 * lands on the next one after it.
 */
export async function writeKlpVersion(
  cardId: string,
  klps: KlpRowInput[],
  hash: string,
  retried = false,
): Promise<{ version: number; klpIds: string[] }> {
  try {
    return await prisma.$transaction(async (tx) => {
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
          klpStatus: 'ready' satisfies CardKlpStatus,
          klpVersion: version,
          klpSourceHash: hash,
          klpError: null,
          // A new KLP version has NEW ids, so its labels and topics do not
          // exist yet. Leaving this 'ready' would serve the previous version's
          // topics against propositions the card no longer teaches — the same
          // staleness `klpSourceHash` exists to catch one level up.
          kltStatus: 'pending' satisfies CardKlpStatus,
          kltError: null,
        },
      });

      // Relations attach to real rows, so callers need the created ids back.
      // Read inside the transaction — it cannot see another writer's rows —
      // rather than `createManyAndReturn`, a Prisma feature this repo has not
      // otherwise adopted.
      const created = await tx.cardKlp.findMany({
        where: { cardId, version },
        orderBy: { index: 'asc' },
        select: { id: true },
      });

      return { version, klpIds: created.map((r) => r.id) };
    });
  } catch (err) {
    if (!retried && isUniqueConstraintError(err)) {
      return writeKlpVersion(cardId, klps, hash, true);
    }
    throw err;
  }
}
