import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { ANALYSIS_VERSION, type AnalysisWrites } from '@/lib/analysis/persist';
import { GRADER_VERSION } from '@/lib/analysis/version';
import { persistKlpStates, rebuildKlpStates, lockKlpStates } from '@/lib/metrics/state-writer';
import { recomputeCardProgress } from '@/lib/memory/recompute';

/**
 * Persists an answer together with its analysis, atomically.
 *
 * One transaction, not an after(): a QuizAnswer without an analysisStatus is a
 * row Spec 3 cannot classify — neither analyzed nor explicitly unanalyzable —
 * and nothing later can tell it apart from an analysis that genuinely failed.
 *
 * The same transaction steps `KlpState` forward for every KLP this answer
 * observed. That materialized posterior is the ONLY thing Spec 3's read path
 * consults for knowledge; without a writer here it stays permanently empty, so
 * every topic's knowledge reads null AND `computeArticulation` books every
 * `too_terse` as a knowledge gap — making the signed verbosity index unable to
 * go negative. Inside the transaction, not after it, so a KlpState that has
 * counted an observation always has the AnswerKlpResult row behind it.
 *
 * `replace` supersedes a prior answer for the same (attempt, card, mode) — the
 * re-submit path. It belongs HERE, inside the transaction, for two reasons:
 *
 * 1. Deleting outside it meant a failure between the delete and the insert lost
 *    the answer entirely, leaving the learner with nothing recorded.
 * 2. The cascade takes the prior answer's `AnswerKlpResult` rows with it, and
 *    `KlpState` is an incremental posterior that cannot be stepped backward. So
 *    the KLPs the deleted rows touched are collected BEFORE the delete and
 *    replayed from surviving evidence afterwards. Without that, a re-submit
 *    steps a posterior that already absorbed the attempt it just deleted —
 *    double-counting it, and inflating `observations` past MIN_OBSERVATIONS on
 *    evidence that no longer exists.
 *
 * The rebuild runs AFTER this answer's own `persistKlpStates`, so any KLP the
 * new answer also touched ends up at the replayed value rather than the stepped
 * one — the replay is authoritative, and it sees the new rows because it reads
 * through the same transaction.
 */
export async function createAnswerWithAnalysis(
  answerData: Prisma.QuizAnswerUncheckedCreateInput,
  writes: AnalysisWrites,
  replace?: { attemptId: string; cardId: string; mode: string },
  /**
   * A caller-supplied transaction, so several answers can be composed into ONE
   * transaction instead of each opening its own. Same shape as
   * `recordStudyEvent`'s optional `tx`, and for the same reason: a diagnostic
   * submits a whole sitting at once and a mid-loop failure must roll the whole
   * sitting back, not leave half a graded test behind.
   *
   * When omitted this opens its own transaction exactly as before.
   */
  tx?: Prisma.TransactionClient,
) {
  const run = async (tx: Prisma.TransactionClient) => {
    // Collected before the delete: once the rows are gone there is no way to
    // learn which KLPs they credited.
    let supersededKlpIds: string[] = [];
    // `replace` is passed on every call site today, even a card's very first
    // answer — it is not evidence anything was actually superseded. Gating
    // the CardProgress replay below on `replace` alone was a real bug: a
    // starred-but-never-studied card (CardProgress with no StudyEvent, from
    // toggleStar) hit the replay on its first-ever quiz answer, replayed zero
    // surviving events, and `recomputeCardProgress` returning null deleted
    // the row — silently unstarring it. Track how many prior answers this
    // replace actually matched so the replay only runs when something was
    // genuinely deleted.
    let priorAnswerCount = 0;
    if (replace) {
      const where = {
        attemptId: replace.attemptId,
        userId: answerData.userId,
        cardId: replace.cardId,
        mode: replace.mode,
      };
      const prior = await tx.quizAnswer.findMany({
        where,
        // Live rows only: a superseded generation's key points are replayed
        // from nothing either way, and every reader of these tables filters
        // the same way (tests/analysis/live-rows-only).
        select: { klpResults: { where: { supersededAt: null }, select: { klpId: true } } },
      });
      priorAnswerCount = prior.length;
      supersededKlpIds = [
        ...new Set(prior.flatMap((p) => p.klpResults.map((r) => r.klpId))),
      ];
      await tx.quizAnswer.deleteMany({ where });
    }

    const answer = await tx.quizAnswer.create({
      data: {
        ...answerData,
        analysisStatus: writes.status,
        analysisVersion: ANALYSIS_VERSION,
        // Which INSTRUMENT produced the rows, beside which CONTRACT they
        // follow (Spec 5 §6). A prompt or lexicon edit moves this and not
        // ANALYSIS_VERSION; a regrade rewrites rows under a new value of it.
        graderVersion: GRADER_VERSION,
        analysisWarnings:
          writes.warnings.length > 0 ? (writes.warnings as unknown as object) : undefined,
      },
    });
    await writeAnalysisGeneration(tx, answer.id, writes);

    // Before ANY posterior read. The step below is read-modify-write with an
    // absolute write, so without this two answers touching one KLP both read
    // the same pre-state and the second drops the first's observation — a
    // permanent loss, since the posterior cannot be stepped backward.
    // Covers the rebuild too: it writes the same rows.
    await lockKlpStates(tx, answerData.userId, [
      ...writes.klpResults.map((r) => r.klpId),
      ...supersededKlpIds,
    ]);

    // `answer.createdAt` (not `new Date()`) so the posterior's clock is the
    // same one `AnswerKlpResult.createdAt` replays from — a backfill and the
    // live writer must converge on the same number.
    await persistKlpStates({
      userId: answerData.userId,
      results: writes.klpResults,
      observedAt: answer.createdAt,
      load: (klpId) =>
        tx.klpState.findUnique({
          where: { userId_klpId: { userId: answerData.userId, klpId } },
          select: {
            userId: true, klpId: true, pKnown: true, observations: true, lastObservedAt: true,
          },
        }),
      save: async (s) => {
        const data = {
          pKnown: s.pKnown,
          observations: s.observations,
          lastObservedAt: s.lastObservedAt,
        };
        await tx.klpState.upsert({
          where: { userId_klpId: { userId: s.userId, klpId: s.klpId } },
          create: { userId: s.userId, klpId: s.klpId, ...data },
          update: data,
        });
      },
    });

    // Last, so it overwrites anything the step above wrote for a KLP whose
    // evidence was just partly deleted.
    await rebuildKlpStates(tx, answerData.userId, supersededKlpIds);

    // The replace above cascaded the prior answer's StudyEvent away (see the
    // quizAnswerId FK). CardProgress is incremental and cannot be stepped
    // backward, so it must be replayed from what survives — otherwise it keeps
    // a confidence step from a row that is gone. This also fixes the older bug
    // where a resubmit stepped confidence twice, because the prior event used
    // to survive the replace entirely.
    // Gated on priorAnswerCount, NOT just `replace`: `replace` is passed on
    // every submission, including a card's first-ever answer, where nothing
    // was superseded and this must not run at all (see note above).
    if (replace && priorAnswerCount > 0) {
      const remaining = await tx.studyEvent.findMany({
        where: { userId: answerData.userId, cardId: replace.cardId },
        select: { correct: true, score: true, createdAt: true },
      });
      const recomputed = recomputeCardProgress(remaining);
      if (recomputed === null) {
        await tx.cardProgress.deleteMany({
          where: { userId: answerData.userId, cardId: replace.cardId },
        });
      } else {
        await tx.cardProgress.upsert({
          where: { userId_cardId: { userId: answerData.userId, cardId: replace.cardId } },
          update: {
            confidence: recomputed.confidence,
            mastery: recomputed.mastery,
            reps: recomputed.reps,
            dueAt: recomputed.dueAt,
            lastSeenAt: recomputed.lastSeenAt,
          },
          create: {
            userId: answerData.userId,
            cardId: replace.cardId,
            confidence: recomputed.confidence,
            mastery: recomputed.mastery,
            reps: recomputed.reps,
            dueAt: recomputed.dueAt,
            lastSeenAt: recomputed.lastSeenAt,
            starred: false,
          },
        });
      }
    }

    return answer;
  };

  return tx ? run(tx) : prisma.$transaction(run, ANALYSIS_TX_OPTIONS);
}

/**
 * Writes ONE generation of an answer's analysis rows: key-point results,
 * error tags, and Spec 5 Phase A's relation results, form results and
 * unwarranted claims.
 *
 * The single row writer, shared by the live path (`createAnswerWithAnalysis`
 * above) and the grader-version regrade (`src/lib/analysis/regrade.ts`). One
 * writer, because a second copy is how the two generations start disagreeing
 * about which columns a row carries — and the regrade's whole claim is that
 * its rows are comparable to the quiz's.
 *
 * Each table is skipped when empty — an empty createMany is a wasted
 * round-trip in a transaction that already serialises one lock per key point.
 * None of the three Phase A tables feeds KlpState: form is not knowledge, a
 * claim is already folded into every credit via the contamination factor, and
 * a relation posterior is Phase B's.
 *
 * `createdAt`, when given, is stamped on every row. The live path leaves it to
 * the column default — which inside a transaction is the transaction's own
 * clock, the same one `QuizAnswer.createdAt` took. The regrade passes the
 * ANSWER's `createdAt`: it re-measures an observation, it does not make a new
 * one, and `rebuildKlpStates` replays by `AnswerKlpResult.createdAt`, so a
 * regraded row dated today would move a months-old observation to today.
 */
export async function writeAnalysisGeneration(
  tx: Prisma.TransactionClient,
  answerId: string,
  writes: AnalysisWrites,
  opts: { createdAt?: Date } = {},
): Promise<void> {
  const stamp = opts.createdAt ? { createdAt: opts.createdAt } : {};
  if (writes.klpResults.length > 0) {
    await tx.answerKlpResult.createMany({
      data: writes.klpResults.map((r) => ({ ...r, ...stamp, quizAnswerId: answerId })),
    });
  }
  if (writes.errorTags.length > 0) {
    await tx.answerErrorTag.createMany({
      data: writes.errorTags.map((t) => ({ ...t, ...stamp, quizAnswerId: answerId })),
    });
  }
  if (writes.relationResults.length > 0) {
    await tx.answerRelationResult.createMany({
      data: writes.relationResults.map((r) => ({ ...r, ...stamp, quizAnswerId: answerId })),
    });
  }
  if (writes.formResults.length > 0) {
    await tx.answerFormResult.createMany({
      data: writes.formResults.map((f) => ({ ...f, ...stamp, quizAnswerId: answerId })),
    });
  }
  if (writes.unwarranted.length > 0) {
    await tx.answerUnwarrantedClaim.createMany({
      data: writes.unwarranted.map((u) => ({ ...u, ...stamp, quizAnswerId: answerId })),
    });
  }
}

/**
 * Prisma's interactive-transaction defaults are 2s to acquire and 5s to run.
 * This transaction performs several SERIALIZED round-trips per KLP — an
 * advisory lock, a read, and a write each — so a five-KLP card on a slow
 * connection can exceed 5s, and a `P2028` timeout here does not degrade: it
 * throws away a graded answer the learner already paid for and shows "Failed
 * to submit answer". The lock also means a second writer on the same KLP now
 * WAITS, which the 2s acquire default was never sized for.
 *
 * Generous rather than tight on purpose: the cost of an over-long timeout is a
 * slow request, the cost of a short one is lost work.
 */
export const ANALYSIS_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

/**
 * A whole diagnostic sitting, not one answer.
 *
 * `submitDiagnosticTest` composes ~12 `createAnswerWithAnalysis` calls inside
 * ONE transaction so a mid-loop failure rolls the sitting back rather than
 * leaving half a graded test behind. Each answer costs a serialized advisory
 * lock, a read and a write per key point, so the per-answer ceiling above is
 * an order of magnitude too small here — and a P2028 does not degrade, it
 * discards twenty minutes of the learner's work.
 */
export const DIAGNOSTIC_TX_OPTIONS = { maxWait: 15_000, timeout: 120_000 };
