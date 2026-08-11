'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { generateJson, resolveTaskModel, AiGenerationError } from '@/lib/ai/generate';
import {
  MULTIPLE_CHOICE_PROMPT,
  GRADE_SHORT_ANSWER_PROMPT,
  MC_FEEDBACK_PROMPT,
  ANNOTATION_PROMPT,
  TRUE_FALSE_PROMPT,
} from '@/lib/ai/prompts/registry';
import {
  MultipleChoiceOptionsSchema,
  MultipleChoiceOptions,
  ShortAnswerGradeSchema,
  MultipleChoiceFeedbackSchema,
  AnnotationSchema,
  MultipleChoiceKlpSchema,
  TrueFalseStatementSchema,
} from '@/lib/ai/schemas';
import { overallQuizScore } from '@/lib/quiz/scoring';
import { revalidatePath } from 'next/cache';
import { QuizSetup } from '@/lib/quiz/setup';
import { recordStudyEvent } from '@/lib/memory/record';
import { normalizeLatency } from '@/lib/memory/latency';
import { recomputeCardProgress } from '@/lib/memory/recompute';
import { safeProfileBlock } from '@/lib/ai/context';
import { ActionResult } from '@/types/action';
import { SessionInsightSchema, type SessionInsight } from '@/lib/memory/insight';
import { ensureKlpsReady } from '@/actions/klp';
import { parseOptionCache, resolveDistractorProvenance, type ParsedOptions, type Corruption } from '@/lib/quiz/options';
import { pickTfVariant } from '@/lib/quiz/coin-flip';
import {
  buildAnalysisWrites,
  ANALYSIS_VERSION,
  type AnalysisWrites,
  type ErrorTagDraft,
  type KlpResultDraft,
} from '@/lib/analysis/persist';
import { toStudySource } from '@/lib/quiz/mode';
import { persistKlpStates, rebuildKlpStates, lockKlpStates } from '@/lib/metrics/state-writer';
import type { StudySource } from '@/lib/memory/scoring';
import { MC_TF_MAGNITUDE } from '@/lib/errors/bands';
import { readableSetWhere } from '@/lib/sets/visibility';

/**
 * Fisher-Yates. The correct answer must not sit in a predictable slot — the
 * v2 prompt asks the model to name distractors, not place them, so shuffling
 * is on us. Not applied to the legacy v1 path: those options already come
 * back in the model's chosen order and existing tests assert on that order.
 */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Why a binary-mode answer's drafts came up empty (or, for a correct answer,
 * whether crediting actually resolved anything). Distinguishes two different
 * reasons for zero rows that must NOT be conflated into one `analyzed`
 * bucket: an answer that legitimately has nothing to attribute BY DESIGN
 * (`deliberate_none`) versus one where attribution was attempted and failed
 * for a data reason (`unattributable`) — a legacy v1 cache row, a v2
 * distractor missing provenance, or a `sourceKlpId`/target that no longer
 * resolves after a mid-attempt card edit superseded the live KLP set.
 */
type Attribution = 'attributed' | 'deliberate_none' | 'unattributable';

/**
 * Analysis drafts for a binary-mode answer, with NO AI call.
 *
 * Everything needed is already on the QuizQuestion row: the generator recorded
 * which KLP each distractor corrupts and how, so a wrong pick diagnoses itself.
 *
 * `targetKlpIds` are the KLPs the QUESTION tested — a correct answer credits
 * all of them, but a wrong answer implicates ONLY the one the learner actually
 * chose. Rejecting the other distractors carries no information, because the
 * correct answer was rejected too.
 */
function binaryModeDrafts(input: {
  mode: StudySource;
  isCorrect: boolean;
  klps: { id: string; weight: number }[];
  targetKlpIds: string[];
  /** The KLP the chosen wrong answer corrupts, when known. */
  failedKlpId: string | null;
  corruption: Corruption | null;
  /**
   * True when the caller already knows there is nothing to attribute BY
   * DESIGN, not because attribution failed — TF where the learner rejected
   * the real (uncorrupted) statement. Rejecting a true statement is
   * second-guessing, not a knowledge gap, so it is a clean `deliberate_none`
   * (zero rows, but nothing went wrong — maps to `analysisStatus: 'analyzed'`).
   * Do NOT set this for an unscored answer (no `QuizQuestion` row / no answer
   * key) — that IS a missing-data case and must fall through to
   * `unattributable` (-> `no_provenance`), the same as a v1 MC cache row, or
   * Spec 3's denominator would count an unevaluated answer as "analyzed and
   * clean". Ignored when `isCorrect` is true.
   */
  deliberateEmpty?: boolean;
}): { klpResults: KlpResultDraft[]; errorTags: ErrorTagDraft[]; attribution: Attribution } {
  const refOf = (id: string) => input.klps.findIndex((k) => k.id === id);

  if (input.isCorrect) {
    const klpResults = input.targetKlpIds
      .map(refOf)
      .filter((ref) => ref >= 0)
      .map((klpRef) => ({ klpRef, status: 'passed' as const }));
    // A correct answer whose targets resolve to nothing is the SAME failure
    // as a wrong pick with no provenance, just wearing a different hat — most
    // often the mid-attempt-edit case, where every id the question was
    // generated against has since been superseded.
    return { klpResults, errorTags: [], attribution: klpResults.length > 0 ? 'attributed' : 'unattributable' };
  }

  if (input.deliberateEmpty) {
    return { klpResults: [], errorTags: [], attribution: 'deliberate_none' };
  }

  // Wrong, and nothing tells us WHICH proposition failed: no QuizQuestion
  // row, a v1 cache row, or a v2 distractor missing provenance. Record no
  // claim rather than an invented one.
  if (!input.failedKlpId || !input.corruption) {
    return { klpResults: [], errorTags: [], attribution: 'unattributable' };
  }

  const klpRef = refOf(input.failedKlpId);
  // The id was real at generation time but no longer resolves against the
  // CURRENT live KLP set — a mid-attempt card edit superseded it.
  if (klpRef < 0) return { klpResults: [], errorTags: [], attribution: 'unattributable' };

  return {
    klpResults: [{ klpRef, status: 'failed' }],
    errorTags: [
      {
        dimension: 'accuracy',
        type: input.corruption,
        klpRef,
        magnitude: MC_TF_MAGNITUDE,
      },
    ],
    attribution: 'attributed',
  };
}

/**
 * Freezes the question as asked, with its KLP provenance. Spec 2 reads this to
 * diagnose a wrong pick with no grading call. Upsert because a user may
 * navigate back to a question before submitting. No-op without an attemptId
 * (e.g. the printable-quiz path, which has no attempt) OR when attemptId
 * doesn't belong to this user — `cardId` ownership is checked by the caller,
 * but `attemptId` is client-supplied too, and previously reached the upsert
 * unchecked, letting a caller plant a QuizQuestion row keyed to someone
 * else's attempt.
 *
 * Bookkeeping only: a failure here must never fail option generation, so
 * callers wrap this in try/catch and swallow — the ownership no-op follows
 * the same contract, silently skipping rather than throwing.
 */
async function recordQuizQuestion(
  attemptId: string | undefined,
  cardId: string,
  parsed: ParsedOptions,
  userId: string,
): Promise<void> {
  if (!attemptId) return;
  const attempt = await prisma.quizAttempt.findFirst({
    where: { id: attemptId, userId },
    select: { id: true },
  });
  if (!attempt) return;
  const targetKlpIds = Array.from(
    new Set(parsed.options.map((o) => o.sourceKlpId).filter((id): id is string => Boolean(id))),
  );
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { klpVersion: true },
  });
  const data = {
    options: parsed.options as unknown as object,
    targetKlpIds,
    // Pinned: a question already asked keeps the version it was asked under,
    // even if the card is edited mid-attempt.
    klpVersion: card?.klpVersion ?? 0,
  };
  await prisma.quizQuestion.upsert({
    where: { attemptId_cardId_mode: { attemptId, cardId, mode: 'multiple-choice' } },
    create: { attemptId, cardId, mode: 'multiple-choice', ...data },
    update: data,
  });
}

export async function getOrGenerateMultipleChoiceOptions(
  cardId: string,
  attemptId?: string,
): Promise<ActionResult<{ cardId: string; options: string[]; correctAnswer: string; cacheHit: boolean; model: string }>> {
  if (!cardId) return { success: false, error: 'Card ID is required' };
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    // Resolved BEFORE generation: which credential/model will actually serve
    // is unknowable up front (the pool rotates LRU-first and fails over on
    // error), but the user's configured intent — their primary credential's
    // model, right now — is, and that's a deterministic, honest cache key.
    // `null` means no usable credential; `generateJson` below will fail with
    // the same `no_credentials` error, so we skip the cache read/write and
    // let that happen rather than caching under a null key.
    // Owner check FIRST, before the cache read. `cardId` is client-supplied;
    // an unscoped load let any authenticated user read another account's card
    // and — via ensureKlpsReady -> extractKlpsForCards — write to their KLP
    // rows. The check must precede the cache short-circuit, or a foreign card
    // with a warm cache still leaks its options.
    const card = await prisma.card.findFirst({
      where: { id: cardId, set: { userId: session.user.id } },
    });
    if (!card) return { success: false, error: 'Card not found' };

    const model = await resolveTaskModel(session.user.id, 'distractors');

    if (model) {
      const cached = await prisma.quizOptionCache.findUnique({
        where: { cardId_model: { cardId, model } },
      });

      const parsedCache = cached ? parseOptionCache(cached.options) : null;
      if (parsedCache) {
        try {
          await recordQuizQuestion(attemptId, cardId, parsedCache, session.user.id);
        } catch (recordErr) {
          console.error('recordQuizQuestion failed (cache hit):', recordErr);
        }
        return {
          success: true,
          data: {
            cardId,
            options: parsedCache.options.map((o) => o.text),
            correctAnswer: parsedCache.correctAnswer,
            cacheHit: true,
            model,
          },
        };
      }
    }

    // Readability-scoped: these sibling cards become MC distractors, so an
    // unguarded fetch hands a caller the full contents of any set by id.
    const set = await prisma.set.findFirst({
      where: { id: card.setId, ...readableSetWhere(session.user.id) },
      include: { cards: true },
    });
    if (!set) return { success: false, error: 'Set not found' };

    const profileBlock = await safeProfileBlock(session.user.id, card.setId, 'MC distractors');

    const klps = await ensureKlpsReady(session.user.id, cardId);

    let optionsJson: unknown;

    if (klps.length > 0) {
      const generated = await generateJson({
        userId: session.user.id,
        task: 'distractors',
        prompt: MULTIPLE_CHOICE_PROMPT.build({
          card,
          siblingCards: set.cards,
          profileBlock,
          klps: klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
        }),
        schema: MultipleChoiceKlpSchema,
      });

      optionsJson = {
        v: 2,
        correctAnswer: generated.correctAnswer,
        options: shuffle([
          { text: generated.correctAnswer, correct: true },
          ...generated.distractors.map((d) => ({
            text: d.text,
            correct: false,
            // Map ref -> real id here. The model never saw the cuid.
            sourceKlpId: klps[d.klpRef]?.id,
            corruption: d.corruption,
          })),
        ]),
      };
    } else {
      // No KLPs (no credential, or extraction failed): legacy prompt, legacy
      // v1 shape. The quiz still works; it just isn't diagnosable.
      const legacy = await generateJson({
        userId: session.user.id,
        task: 'distractors',
        prompt: MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: set.cards, profileBlock }),
        schema: MultipleChoiceOptionsSchema,
      });
      optionsJson = legacy;
    }

    // `generateJson` above resolves against the exact same candidate pool as
    // `resolveTaskModel` did; if that pool were empty, it would have thrown
    // AiGenerationError before this point. So `model` is guaranteed non-null
    // here even though its static type is still `string | null` — the guard
    // below is defensive documentation, not an expected runtime path.
    if (!model) {
      throw new Error('unreachable: generation succeeded with no resolvable model');
    }

    // `upsert`, not `create`: two concurrent generations for the same card
    // would otherwise race on the `cardId_model` unique constraint and the
    // loser would surface as "Failed to generate quiz options."
    await prisma.quizOptionCache.upsert({
      where: { cardId_model: { cardId, model } },
      create: { cardId, model, options: optionsJson as any },
      update: { options: optionsJson as any },
    });

    const parsed = parseOptionCache(optionsJson)!;
    try {
      await recordQuizQuestion(attemptId, cardId, parsed, session.user.id);
    } catch (recordErr) {
      console.error('recordQuizQuestion failed (fresh generation):', recordErr);
    }

    return {
      success: true,
      data: {
        cardId,
        options: parsed.options.map((o) => o.text),
        correctAnswer: parsed.correctAnswer,
        cacheHit: false,
        model,
      },
    };
  } catch (err) {
    if (err instanceof AiGenerationError) {
      return { success: false, error: err.detail.title, detail: err.detail };
    }
    console.error('Quiz generation error:', err);
    return { success: false, error: 'Failed to generate quiz options.' };
  }
}

export async function startQuizAttempt(
  setId: string,
  modes: ('multiple-choice' | 'short-answer' | 'matching' | 'true-false')[],
  setup: QuizSetup,
  questionCount?: number,
  timerSeconds?: number
): Promise<ActionResult<{ attemptId: string; cardIds: string[]; sessionId: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    // Readability-scoped. This was the shape Spec 2b explicitly declined to
    // patch in isolation — the set page had the same hole, so fixing one call
    // site would have been inconsistent rather than a fix. Both are fixed now.
    // Not-found, never forbidden: a distinguishable error would confirm to an
    // id-prober that a private set exists.
    const set = await prisma.set.findFirst({
      where: { id: setId, ...readableSetWhere(session.user.id) },
      include: {
        cards: {
          include: {
            categoryAssignments: { include: { category: true } },
            progress: { where: { userId: session.user.id } }
          }
        }
      },
    });
    if (!set) return { success: false, error: 'Set not found' };

    const quizAnswers = await prisma.quizAnswer.findMany({
      where: { userId: session.user.id, card: { setId } },
    });

    const enrichedCards = set.cards.map(card => ({
      ...card,
      starred: card.progress[0]?.starred || false,
      categoryIds: card.categoryAssignments.map(ca => ca.categoryId),
    }));

    const { filterQuizCards } = await import('@/lib/quiz/setup');
    const filteredCards = filterQuizCards(enrichedCards, setup, quizAnswers);

    if (filteredCards.length === 0) {
      return { success: false, error: 'No cards match the selected filters.' };
    }

    // Strict validation for Starred/Failed only
    if (setup.starredOnly && filteredCards.length < (setup.questionCount || 1)) {
      return { success: false, error: 'Error: not enough starred flashcards' };
    }

    if (setup.failedOnly && filteredCards.length < (setup.questionCount || 1)) {
      return { success: false, error: 'Error: not enough previously failed flashcards' };
    }

    const targetCount = Math.min(setup.questionCount || questionCount || set.cards.length, filteredCards.length);

    const selectedIds = filteredCards
      .sort(() => Math.random() - 0.5)
      .slice(0, targetCount)
      .map(c => c.id);

    // A StudySession envelope and the QuizAttempt are created together so an
    // attempt can never exist without one — the activity feed reads sessions,
    // so an orphaned attempt would be invisible there.
    const { attempt, sessionId } = await prisma.$transaction(async (tx) => {
      const createdSession = await tx.studySession.create({
        data: {
          userId: session.user.id,
          setId,
          kind: 'quiz',
          itemCount: selectedIds.length,
          categoryIds: setup.categoryIds ?? undefined,
        },
      });
      const createdAttempt = await tx.quizAttempt.create({
        data: {
          userId: session.user.id,
          setId,
          sessionId: createdSession.id,
          mode: modes[0] || 'multiple-choice', // Primary mode for legacy support
          selectedCardIds: selectedIds,
          questionMode: modes as any, // Store the full array
          questionCount: setup.questionCount ?? questionCount ?? selectedIds.length,
          promptSide: setup.promptSide,
          categoryIds: setup.categoryIds,
          starredOnly: setup.starredOnly,
          failedOnly: setup.failedOnly,
          printable: setup.printable,
        },
      });
      return { attempt: createdAttempt, sessionId: createdSession.id };
    });
    return { success: true, data: { attemptId: attempt.id, cardIds: selectedIds, sessionId } };
  } catch (error) {
    console.error('Error in startQuizAttempt:', error);
    return { success: false, error: `Failed to start quiz: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

export async function submitMultipleChoiceAnswer(input: {
  attemptId: string;
  cardId: string;
  selectedOption: string;
  correctAnswer: string;
  latencyMs?: number;
}): Promise<ActionResult<{ isCorrect: boolean; score: number; feedback?: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const isCorrect = input.selectedOption.trim().toLowerCase() === input.correctAnswer.trim().toLowerCase();
  const score = isCorrect ? 100 : 0;

  try {
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: input.attemptId, userId: session.user.id },
      select: { sessionId: true },
    });
    // The owner-scoped lookup above was previously never checked: a foreign
    // attemptId still fell through and deleted/inserted rows on that attempt.
    if (!attempt) return { success: false, error: 'Attempt not found' };

    let feedback = isCorrect ? 'Correct!' : 'Incorrect.';
    const card = await prisma.card.findUnique({ where: { id: input.cardId } });
    if (card) {
      try {
        const prompt = MC_FEEDBACK_PROMPT.build({ card, selected: input.selectedOption, correct: input.correctAnswer });
        const aiResult = await generateJson({
          userId: session.user.id,
          task: 'distractors',
          prompt,
          schema: MultipleChoiceFeedbackSchema,
        });
        feedback = aiResult.feedback;
      } catch (aiErr) {
        // AI feedback is a nice-to-have here; the default Correct!/Incorrect.
        // string above already covers the case (e.g. no credential saved).
        console.error('MC feedback generation failed:', aiErr);
      }
    }

    // Diagnose the wrong pick with NO AI call: the generator already recorded
    // which KLP each distractor corrupts and how, on the QuizQuestion row.
    const question = await prisma.quizQuestion.findUnique({
      where: { attemptId_cardId_mode: { attemptId: input.attemptId, cardId: input.cardId, mode: 'multiple-choice' } },
    });
    const parsed = question?.options
      ? parseOptionCache({ v: 2, correctAnswer: input.correctAnswer, options: question.options })
      : null;
    const provenance = parsed && !isCorrect
      ? resolveDistractorProvenance(parsed, input.selectedOption)
      : null;

    const klps = await ensureKlpsReady(session.user.id, input.cardId);
    const progress = await prisma.cardProgress.findUnique({
      where: { userId_cardId: { userId: session.user.id, cardId: input.cardId } },
      select: { starred: true },
    });

    const mode = toStudySource('multiple-choice');
    const drafts = binaryModeDrafts({
      mode,
      isCorrect,
      klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
      targetKlpIds: (question?.targetKlpIds as string[] | null) ?? [],
      failedKlpId: provenance?.sourceKlpId ?? null,
      corruption: provenance?.corruption ?? null,
    });

    // A pick we could not attribute (no provenance, or a stale klp id) is
    // `no_provenance`, NOT a clean answer — `binaryModeDrafts` already tells
    // us which case we're in via `attribution`.
    const forcedStatus =
      drafts.attribution === 'unattributable' ? ('no_provenance' as const) : undefined;

    const writes = buildAnalysisWrites({
      mode,
      klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
      starred: progress?.starred ?? false,
      klpResults: drafts.klpResults,
      errorTags: drafts.errorTags,
      forcedStatus,
    });

    const answer = await createAnswerWithAnalysis(
      {
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        mode: 'multiple-choice',
        prompt: 'Multiple choice',
        correctAnswer: input.correctAnswer,
        selectedOption: input.selectedOption,
        isCorrect,
        score,
        latencyMs: normalizeLatency(input.latencyMs),
        feedback,
      },
      writes,
      // Replace only this card's answer *in this mode* (a card may also be
      // tested in another mode within the same attempt — keep those intact).
      // Inside the transaction, so a failure here can never leave the learner
      // with the old answer deleted and no new one written.
      { attemptId: input.attemptId, cardId: input.cardId, mode: 'multiple-choice' },
    );

    try {
      await recordStudyEvent({
        userId: session.user.id,
        cardId: input.cardId,
        source: 'quiz-mc',
        sessionId: attempt?.sessionId ?? undefined,
        quizAnswerId: answer.id,
        outcome: { correct: isCorrect },
        meta: { latencyMs: input.latencyMs },
      });
    } catch (memErr) {
      console.error('recordStudyEvent failed for quiz-mc:', memErr);
    }

    const allAnswers = await prisma.quizAnswer.findMany({ where: { attemptId: input.attemptId } });
    const newScore = overallQuizScore(allAnswers);
    if (newScore !== null) {
      await prisma.quizAttempt.update({
        where: { id: input.attemptId },
        data: { score: Math.round(newScore) },
      });
    }

    return { success: true, data: { isCorrect, score, feedback } };
  } catch (error) {
    return { success: false, error: 'Failed to submit answer' };
  }
}

export async function submitTrueFalseAnswer(input: {
  attemptId: string;
  cardId: string;
  selectedOption: string;
  latencyMs?: number;
}): Promise<ActionResult<{ isCorrect: boolean | null; score: number | null; feedback?: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: input.attemptId, userId: session.user.id },
      select: { sessionId: true },
    });
    // See submitMultipleChoiceAnswer: the result of this owner-scoped lookup
    // was previously discarded, so a foreign attemptId could delete another
    // user's answers, insert into their attempt, and overwrite their score.
    if (!attempt) return { success: false, error: 'Attempt not found' };

    // One-shot: true/false returns `isCorrect`, so allowing a re-submit turned
    // any wrong answer into a right one on the next round-trip (delete + create
    // + score recompute). `commitAll` in TrueFalseQuiz.tsx submits once, so
    // rejecting a second submission matches the UI's real semantics.
    const alreadyAnswered = await prisma.quizAnswer.findFirst({
      where: {
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        mode: 'true-false',
      },
      select: { id: true },
    });
    if (alreadyAnswered) {
      return { success: false, error: 'This question has already been answered.' };
    }

    const question = await prisma.quizQuestion.findUnique({
      where: {
        attemptId_cardId_mode: {
          attemptId: input.attemptId,
          cardId: input.cardId,
          mode: 'true-false',
        },
      },
    });

    // No question row means this answer predates Task 10, or generation never
    // ran. There is no answer key, so the answer is recorded UNSCORED rather
    // than graded against an assumption. The old code assumed "true" and marked
    // every such answer correct, feeding free correctness into study memory.
    const isCorrect =
      question && question.isTrue !== null
        ? (input.selectedOption === 'true') === question.isTrue
        : null;
    const score = isCorrect === null ? null : isCorrect ? 100 : 0;

    let feedback = isCorrect === null ? 'Unscored.' : isCorrect ? 'Correct!' : 'Incorrect.';
    const card = await prisma.card.findUnique({ where: { id: input.cardId } });
    if (card) {
      try {
        const prompt = MC_FEEDBACK_PROMPT.build({
          card,
          selected: input.selectedOption,
          correct: question?.isTrue === false ? 'false' : 'true',
        });
        const aiResult = await generateJson({
          userId: session.user.id,
          task: 'distractors',
          prompt,
          schema: MultipleChoiceFeedbackSchema,
        });
        feedback = aiResult.feedback;
      } catch (aiErr) {
        // AI feedback is a nice-to-have here; the default Correct!/Incorrect.
        // string above already covers the case (e.g. no credential saved).
        console.error('TF feedback generation failed:', aiErr);
      }
    }

    const klps = await ensureKlpsReady(session.user.id, input.cardId);
    const progress = await prisma.cardProgress.findUnique({
      where: { userId_cardId: { userId: session.user.id, cardId: input.cardId } },
      select: { starred: true },
    });

    // Only a wrong answer to a CORRUPTED statement implicates a KLP. Answering
    // "false" to the real definition means the learner rejected something true —
    // second-guessing, not a knowledge gap (docs/ai/error-taxonomy.md §4).
    // Recording `failed` there would teach Spec 3 they lack a proposition they
    // may well hold.
    const rejectedTruth = question?.isTrue === true;
    const failedKlpId =
      isCorrect === false && !rejectedTruth
        ? ((question?.targetKlpIds as string[] | null) ?? [])[0] ?? null
        : null;

    const mode = toStudySource('true-false');
    const drafts = binaryModeDrafts({
      mode,
      isCorrect: isCorrect === true,
      klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
      targetKlpIds: (question?.targetKlpIds as string[] | null) ?? [],
      failedKlpId,
      corruption: (question?.corruption as Corruption | null) ?? null,
      // Only the "rejected the true statement" case is deliberate. An
      // unscored answer (isCorrect === null, no question row) is missing
      // data, not a by-design non-finding — it must fall through to
      // `unattributable` on its own via the null failedKlpId/corruption
      // below, not be forced here.
      deliberateEmpty: rejectedTruth,
    });

    // A wrong pick we could not attribute (no question row, or a stale klp
    // id) is `no_provenance`, NOT a clean `analyzed` answer.
    const forcedStatus =
      drafts.attribution === 'unattributable' ? ('no_provenance' as const) : undefined;

    const writes = buildAnalysisWrites({
      mode,
      klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
      starred: progress?.starred ?? false,
      klpResults: drafts.klpResults,
      errorTags: drafts.errorTags,
      forcedStatus,
    });

    const answer = await createAnswerWithAnalysis(
      {
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        mode: 'true-false',
        prompt: question?.statement ?? 'True/False',
        correctAnswer: question?.isTrue === false ? 'false' : 'true',
        selectedOption: input.selectedOption,
        isCorrect,
        score,
        latencyMs: normalizeLatency(input.latencyMs),
        feedback,
      },
      writes,
      // Unreachable given the one-shot `alreadyAnswered` guard above, but kept
      // as a belt-and-braces idempotency guard against a partial prior write —
      // and now it also rolls back that partial write's posterior rather than
      // leaving it stepped by evidence the cascade removed.
      { attemptId: input.attemptId, cardId: input.cardId, mode: 'true-false' },
    );

    if (isCorrect !== null) {
      try {
        await recordStudyEvent({
          userId: session.user.id,
          cardId: input.cardId,
          source: 'quiz-tf',
          sessionId: attempt?.sessionId ?? undefined,
          quizAnswerId: answer.id,
          outcome: { correct: isCorrect },
          meta: { latencyMs: input.latencyMs },
        });
      } catch (memErr) {
        console.error('recordStudyEvent failed for quiz-tf:', memErr);
      }
    }

    const allAnswers = await prisma.quizAnswer.findMany({ where: { attemptId: input.attemptId } });
    const newScore = overallQuizScore(allAnswers);
    if (newScore !== null) {
      // `updateMany` scoped by userId, not `update` by id: the score write can
      // then never touch a foreign attempt row even if the guard above is
      // later removed or refactored away.
      await prisma.quizAttempt.updateMany({
        where: { id: input.attemptId, userId: session.user.id },
        data: { score: Math.round(newScore) },
      });
    }

    return { success: true, data: { isCorrect, score, feedback } };
  } catch (error) {
    return { success: false, error: 'Failed to submit answer' };
  }
}

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
async function createAnswerWithAnalysis(
  answerData: Prisma.QuizAnswerUncheckedCreateInput,
  writes: AnalysisWrites,
  replace?: { attemptId: string; cardId: string; mode: string },
) {
  return prisma.$transaction(async (tx) => {
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
        select: { klpResults: { select: { klpId: true } } },
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
        analysisWarnings:
          writes.warnings.length > 0 ? (writes.warnings as unknown as object) : undefined,
      },
    });
    if (writes.klpResults.length > 0) {
      await tx.answerKlpResult.createMany({
        data: writes.klpResults.map((r) => ({ ...r, quizAnswerId: answer.id })),
      });
    }
    if (writes.errorTags.length > 0) {
      await tx.answerErrorTag.createMany({
        data: writes.errorTags.map((t) => ({ ...t, quizAnswerId: answer.id })),
      });
    }

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
  }, ANALYSIS_TX_OPTIONS);
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
const ANALYSIS_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

/**
 * Records a placeholder answer when short-answer grading itself failed to
 * produce a grade — `analysisStatus: 'failed'` rather than leaving a total
 * gap where the spec's own degradation table (§5: "No AI credential ->
 * failed") describes behaviour that never actually happens.
 *
 * Best-effort: swallows its OWN write failure so a DB hiccup here can never
 * mask the original grading error, which the caller re-throws to the
 * existing outer catch — the client-facing contract (a plain
 * `{ success: false }`) is unchanged.
 */
async function recordFailedShortAnswerAnalysis(input: {
  attemptId: string;
  userId: string;
  cardId: string;
  answer: string;
  correctAnswer: string;
  klps: { id: string; weight: number }[];
  starred: boolean;
  latencyMs?: number;
}): Promise<void> {
  try {
    const writes = buildAnalysisWrites({
      mode: toStudySource('short-answer'),
      klps: input.klps,
      starred: input.starred,
      klpResults: [],
      errorTags: [],
      forcedStatus: 'failed',
    });
    await createAnswerWithAnalysis(
      {
        attemptId: input.attemptId,
        userId: input.userId,
        cardId: input.cardId,
        mode: 'short-answer',
        prompt: input.answer,
        answer: input.answer,
        correctAnswer: input.correctAnswer,
        score: null,
        isCorrect: null,
        latencyMs: normalizeLatency(input.latencyMs),
        feedback: 'Grading failed.',
      },
      writes,
      // A failed re-grade still supersedes the prior answer — and, because it
      // goes through the same helper, still replays the posterior for whatever
      // KLPs that prior answer had credited.
      { attemptId: input.attemptId, cardId: input.cardId, mode: 'short-answer' },
    );
  } catch (writeErr) {
    console.error('Failed to record failed-grading analysis row:', writeErr);
  }
}

export async function submitShortAnswer(input: {
  attemptId: string;
  cardId: string;
  answer: string;
  latencyMs?: number;
}): Promise<ActionResult<{ grade: any; score: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: input.attemptId, userId: session.user.id },
      select: { sessionId: true },
    });
    // See submitMultipleChoiceAnswer: this owner-scoped lookup's result was
    // previously discarded, leaving a foreign attemptId fully writable.
    if (!attempt) return { success: false, error: 'Attempt not found' };

    // The prior short-answer row is superseded inside the write transaction
    // (see `createAnswerWithAnalysis`), not deleted up here. Deleting first
    // meant a grading failure that also failed to record its placeholder left
    // the learner with no answer at all — and it dropped `AnswerKlpResult`
    // rows without ever rolling back the posterior they had been folded into.
    const replaces = {
      attemptId: input.attemptId,
      cardId: input.cardId,
      mode: 'short-answer',
    };

    const card = await prisma.card.findUnique({
      where: { id: input.cardId },
      include: { contentBlocks: true },
    });
    if (!card) return { success: false, error: 'Card not found' };

    const profileBlock = await safeProfileBlock(session.user.id, card.setId, 'short-answer grading');

    // Live KLPs (empty when extraction is impossible) and starred state,
    // resolved once and shared by both branches below: both the prompt (so
    // the model can return per-KLP outcomes) and the post-grade analysis
    // write need the same KLPs and the same starred flag.
    const klps = await ensureKlpsReady(session.user.id, input.cardId);
    const progress = await prisma.cardProgress.findUnique({
      where: { userId_cardId: { userId: session.user.id, cardId: input.cardId } },
      select: { starred: true },
    });
    // No progress row means the learner has never interacted with this card —
    // a definite "not starred", not missing data.
    const starred = progress?.starred ?? false;
    const promptKlps = klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind }));

    // Get content blocks for the term side (what the user was asked about)
    const termBlocks = card.contentBlocks
      .filter(b => b.side === 'term')
      .sort((a, b) => a.position - b.position);

    // Use text-only path if no media
    if (termBlocks.every(b => b.type === 'text')) {
      const prompt = GRADE_SHORT_ANSWER_PROMPT.build({
        card,
        answer: input.answer,
        profileBlock,
        klps: promptKlps.length > 0 ? promptKlps : undefined,
      });
      let grade;
      try {
        grade = await generateJson({
          userId: session.user.id,
          task: 'grade',
          prompt,
          schema: ShortAnswerGradeSchema,
        });
      } catch (gradingErr) {
        await recordFailedShortAnswerAnalysis({
          attemptId: input.attemptId,
          userId: session.user.id,
          cardId: input.cardId,
          answer: input.answer,
          correctAnswer: card.definition,
          klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
          starred,
          latencyMs: input.latencyMs,
        });
        throw gradingErr;
      }

      let annotations: any[] = [];
      try {
        const annPrompt = ANNOTATION_PROMPT.build({ card, answer: input.answer, correct: card.definition, profileBlock });
        const annResult = await generateJson({
          userId: session.user.id,
          task: 'grade',
          prompt: annPrompt,
          schema: AnnotationSchema,
        });
        annotations = annResult.annotations;
      } catch (e) {
        console.error('Annotation generation failed:', e);
      }

      const score = grade.overall * 10;
      const isCorrect = grade.overall >= 8;

      // Spec 2a §4: a correct SA answer writes one row per KLP on the card —
      // the grader evaluates each regardless of overall correctness. Empty
      // klpResults on a card that HAS live KLPs means the grader didn't do
      // the per-KLP judgment it was asked for, never a legitimately clean
      // grade. Unlike MC/TF there's no legacy-cache case here, so this is
      // the only no_provenance trigger for short answer.
      const forcedStatus =
        klps.length > 0 && (grade.klpResults ?? []).length === 0 ? ('no_provenance' as const) : undefined;

      const writes = buildAnalysisWrites({
        mode: toStudySource('short-answer'),
        klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
        starred,
        klpResults: grade.klpResults ?? [],
        errorTags: (grade.errorTags ?? []) as ErrorTagDraft[],
        forcedStatus,
      });

      const answer = await createAnswerWithAnalysis(
        {
          attemptId: input.attemptId,
          userId: session.user.id,
          cardId: input.cardId,
          mode: 'short-answer',
          prompt: input.answer,
          answer: input.answer,
          correctAnswer: card.definition,
          grade: { ...grade, annotations, promptVersion: GRADE_SHORT_ANSWER_PROMPT.version },
          score,
          isCorrect,
          latencyMs: normalizeLatency(input.latencyMs),
          feedback: grade.summary,
        },
        writes,
        replaces,
      );

      try {
        await recordStudyEvent({
          userId: session.user.id,
          cardId: input.cardId,
          source: 'quiz-sa',
          sessionId: attempt?.sessionId ?? undefined,
          quizAnswerId: answer.id,
          outcome: { overall: grade.overall },
          meta: { latencyMs: input.latencyMs },
        });
      } catch (memErr) {
        console.error('recordStudyEvent failed for quiz-sa (text path):', memErr);
      }

      const allAnswers = await prisma.quizAnswer.findMany({ where: { attemptId: input.attemptId } });
      const newScore = overallQuizScore(allAnswers);
      if (newScore !== null) {
        await prisma.quizAttempt.update({
          where: { id: input.attemptId },
          data: { score: Math.round(newScore) },
        });
      }

      return { success: true, data: { grade, score } };
    }

    // Multimodal path: convert blocks to ContentBlocks and build parts
    const contentBlocks = termBlocks.map(b => ({
      type: b.type as any,
      text: b.text,
      position: b.position,
    })) as any;

    const { parts } = GRADE_SHORT_ANSWER_PROMPT.buildParts({
      card,
      promptBlocks: contentBlocks,
      answer: input.answer,
      profileBlock,
      klps: promptKlps.length > 0 ? promptKlps : undefined,
    });

    // In a full implementation, assetToPart would be called here to add inlineData
    // For now, we just use the text parts as fallback
    let grade;
    try {
      grade = await generateJson({
        userId: session.user.id,
        task: 'grade',
        parts,
        schema: ShortAnswerGradeSchema,
      });
    } catch (gradingErr) {
      await recordFailedShortAnswerAnalysis({
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        answer: input.answer,
        correctAnswer: card.definition,
        klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
        starred,
        latencyMs: input.latencyMs,
      });
      throw gradingErr;
    }

    let annotations: any[] = [];
    try {
      const annPrompt = ANNOTATION_PROMPT.build({ card, answer: input.answer, correct: card.definition, profileBlock });
      const annResult = await generateJson({
        userId: session.user.id,
        task: 'grade',
        prompt: annPrompt,
        schema: AnnotationSchema,
      });
      annotations = annResult.annotations;
    } catch (e) {
      console.error('Annotation generation failed:', e);
    }

    const score = grade.overall * 10;
    const isCorrect = grade.overall >= 8;

    // See the text-only path above: empty klpResults on a card with live
    // KLPs is never a legitimately clean grade for short answer.
    const forcedStatus =
      klps.length > 0 && (grade.klpResults ?? []).length === 0 ? ('no_provenance' as const) : undefined;

    const writes = buildAnalysisWrites({
      mode: toStudySource('short-answer'),
      klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
      starred,
      klpResults: grade.klpResults ?? [],
      errorTags: (grade.errorTags ?? []) as ErrorTagDraft[],
      forcedStatus,
    });

    const answer = await createAnswerWithAnalysis(
      {
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        mode: 'short-answer',
        prompt: input.answer,
        answer: input.answer,
        correctAnswer: card.definition,
        grade: { ...grade, annotations, promptVersion: GRADE_SHORT_ANSWER_PROMPT.version },
        score,
        isCorrect,
        latencyMs: normalizeLatency(input.latencyMs),
        feedback: grade.summary,
      },
      writes,
      replaces,
    );

    try {
      await recordStudyEvent({
        userId: session.user.id,
        cardId: input.cardId,
        source: 'quiz-sa',
        sessionId: attempt?.sessionId ?? undefined,
        quizAnswerId: answer.id,
        outcome: { overall: grade.overall },
        meta: { latencyMs: input.latencyMs },
      });
    } catch (memErr) {
      console.error('recordStudyEvent failed for quiz-sa (multimodal path):', memErr);
    }

    const allAnswers = await prisma.quizAnswer.findMany({ where: { attemptId: input.attemptId } });
    const newScore = overallQuizScore(allAnswers);
    if (newScore !== null) {
      await prisma.quizAttempt.update({
        where: { id: input.attemptId },
        data: { score: Math.round(newScore) },
      });
    }

    return { success: true, data: { grade, score } };
  } catch (err) {
    if (err instanceof AiGenerationError) {
      return { success: false, error: err.detail.title, detail: err.detail };
    }
    console.error('Grading error:', err);
    return { success: false, error: 'Failed to generate quiz summary' };
  }
}

export async function getQuizAttemptCards(attemptId: string): Promise<ActionResult<{ cards: any[] }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    // Owner-scoped: previously findUnique({ where: { id: attemptId } }) had no
    // ownership check, letting any authenticated user fetch another user's
    // full deck of cards (term, definition, content blocks) for an
    // in-progress or completed attempt. Same fix as getQuizAttemptSummary.
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: attemptId, userId: session.user.id },
    });
    if (!attempt || !attempt.selectedCardIds) return { success: false, error: 'Attempt not found' };

    const cardIds = attempt.selectedCardIds as string[];
    const cards = await prisma.card.findMany({
      where: { id: { in: cardIds } },
      include: { contentBlocks: { orderBy: { position: 'asc' } } },
    });

    const sortedCards = cardIds.map(id => cards.find(c => c.id === id)).filter(Boolean);

    return { success: true, data: { cards: sortedCards } };
  } catch (error) {
    return { success: false, error: 'Failed to fetch quiz cards' };
  }
}

type QuizAttemptSummaryResult = {
  attempt: any;
  insight: SessionInsight | null;
};

export async function getQuizAttemptSummary(attemptId: string): Promise<ActionResult<QuizAttemptSummaryResult>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    // Owner-scoped: previously `findUnique({ where: { id: attemptId } })` had
    // no ownership check at all, so any authenticated user who knew or
    // guessed an attemptId could read another user's full results —
    // including, as of Spec 2b, verbatim quotes from their short answers via
    // AnswerKlpResult.evidence / AnswerErrorTag.quote. Matches the
    // owner-scoped `findFirst` pattern already used by the submit* actions.
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: attemptId, userId: session.user.id },
      include: {
        user: true,
        set: { include: { cards: true } },
        session: true,
        answers: {
          include: {
            card: { include: { contentBlocks: { orderBy: { position: 'asc' } } } },
            klpResults: {
              include: { klp: { select: { text: true, kind: true } } },
            },
            errorTags: {
              include: {
                klp: { select: { text: true, kind: true } },
                secondaryKlp: { select: { text: true, kind: true } },
              },
            },
          },
        },
      },
    });
    if (!attempt) return { success: false, error: 'Attempt not found' };

    // Fetch MC options for answers that are multiple-choice. `model` is no
    // longer filtered on: each user's generation now runs against whichever
    // credential/model they have configured, so a fixed value would silently
    // match nothing (same fix as src/app/sets/[id]/print/page.tsx). Take the
    // most recent cache row per card instead.
    const mcAnswers = attempt.answers.filter(a => a.mode === 'multiple-choice');
    if (mcAnswers.length > 0) {
      const cardIds = mcAnswers.map(a => a.cardId);
      const cachedOptions = await prisma.quizOptionCache.findMany({
        where: { cardId: { in: cardIds } },
        orderBy: { updatedAt: 'desc' },
      });
      // First row per cardId that parses successfully wins (list is
      // newest-first), so a corrupt newest cache entry falls through to an
      // older valid one instead of blanking the question — matches
      // src/app/sets/[id]/print/page.tsx's more tolerant read.
      const parsedByCard = new Map<string, { options: string[]; correctAnswer: string }>();
      for (const row of cachedOptions) {
        if (parsedByCard.has(row.cardId)) continue;
        const parsed = parseOptionCache(row.options);
        if (!parsed) {
          console.error(`Failed to parse options for card ${row.cardId}`);
          continue;
        }
        parsedByCard.set(row.cardId, {
          options: parsed.options.map((o) => o.text),
          correctAnswer: parsed.correctAnswer,
        });
      }

      attempt.answers = attempt.answers.map(a => {
        if (a.mode === 'multiple-choice') {
          const cache = parsedByCard.get(a.cardId);
          if (cache) return { ...a, options: cache.options };
        }
        return a;
      });
    }

    // Read, never generate. Regenerating here is what made every render of a
    // results page cost an AI call. A blob that fails to parse (older version,
    // partial write) degrades to null and the UI offers to regenerate.
    const parsedInsight = SessionInsightSchema.safeParse(attempt.session?.insight);

    return {
      success: true,
      data: {
        attempt,
        insight: parsedInsight.success ? parsedInsight.data : null,
      },
    };
  } catch (error: any) {
    console.error('Summary generation error:', error);
    return { success: false, error: 'Failed to generate quiz summary' };
  }
}

/**
 * Resolves this attempt's true/false question for a card, generating it on
 * first request and returning ONLY the statement.
 *
 * The answer key lives in QuizQuestion.isTrue and never crosses the wire.
 * Before this existed the client rendered the real definition and
 * submitTrueFalseAnswer hardcoded `correctAnswer: 'true'`, so every true/false
 * answer was correct and the mode fed free correctness into study memory.
 */
export async function getTrueFalseQuestion(
  attemptId: string,
  cardId: string,
): Promise<ActionResult<{ statement: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: attemptId, userId: session.user.id },
      select: { id: true, selectedCardIds: true },
    });
    if (!attempt) return { success: false, error: 'Attempt not found' };

    // Defence in depth: the card must be one this attempt actually selected,
    // so a foreign-but-owned card cannot be injected into an attempt and get a
    // QuizQuestion row written against it. A non-array `selectedCardIds`
    // (legacy attempts predating the column) imposes no restriction — the
    // owner check below is still the hard boundary.
    if (
      Array.isArray(attempt.selectedCardIds) &&
      !(attempt.selectedCardIds as unknown[]).includes(cardId)
    ) {
      return { success: false, error: 'Card not found' };
    }

    // Already generated: return the same statement. Re-flipping on a revisit
    // would change the question under the user mid-attempt.
    const existing = await prisma.quizQuestion.findUnique({
      where: { attemptId_cardId_mode: { attemptId, cardId, mode: 'true-false' } },
    });
    if (existing?.statement) return { success: true, data: { statement: existing.statement } };

    // Owner-scoped: `cardId` is client-supplied and this path writes (via
    // ensureKlpsReady -> extractKlpsForCards) to the card's KLP rows.
    const card = await prisma.card.findFirst({
      where: { id: cardId, set: { userId: session.user.id } },
    });
    if (!card) return { success: false, error: 'Card not found' };

    const klps = await ensureKlpsReady(session.user.id, cardId);

    let statement = card.definition;
    let isTrue = true;
    let targetKlpIds: string[] = klps.map((k) => k.id);
    // Which corruption was applied to the target KLP. Persisted alongside
    // isTrue so a wrong TF answer is diagnosable with no grading call — MC
    // keeps the same fact per-option inside its `options` blob. Stays null for
    // the true variant and for the generation-failure fallback.
    let corruption: string | null = null;

    if (klps.length > 0 && pickTfVariant() === 'false') {
      try {
        const generated = await generateJson({
          userId: session.user.id,
          task: 'distractors',
          prompt: TRUE_FALSE_PROMPT.build({
            card,
            klps: klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
          }),
          schema: TrueFalseStatementSchema,
        });
        // An unresolvable klpRef is treated as a generation failure, not a
        // partial success: writing isTrue=false with the default (all-KLPs)
        // targetKlpIds would be indistinguishable from a genuine true-variant
        // row, and a statement we can't attribute to a KLP isn't
        // diagnostically useful. statement/isTrue/targetKlpIds stay in
        // lockstep at their true-variant defaults below.
        const target = klps[generated.klpRef]?.id;
        if (target) {
          statement = generated.statement;
          isTrue = false;
          targetKlpIds = [target];
          corruption = generated.corruption;
        } else {
          console.error('TF statement generation returned an out-of-range klpRef:', generated.klpRef);
        }
      } catch (err) {
        // Generation failed: fall back to the true variant rather than
        // failing the question. Still diagnosable — just not this time.
        console.error('TF statement generation failed:', err);
      }
    }

    // `upsert`, not `create`: two concurrent requests for the same question
    // (StrictMode double-mount, a retry, a double navigation) would otherwise
    // both pass the findUnique check above, then race on the
    // `attemptId_cardId_mode` unique constraint — the loser's create() would
    // throw even though a perfectly valid row now exists. Matches the
    // recordQuizQuestion precedent above.
    await prisma.quizQuestion.upsert({
      where: { attemptId_cardId_mode: { attemptId, cardId, mode: 'true-false' } },
      create: { attemptId, cardId, mode: 'true-false', statement, isTrue, corruption, targetKlpIds, klpVersion: card.klpVersion },
      update: { statement, isTrue, corruption, targetKlpIds, klpVersion: card.klpVersion },
    });

    return { success: true, data: { statement } };
  } catch (err) {
    console.error('getTrueFalseQuestion failed:', err);
    return { success: false, error: 'Failed to load question' };
  }
}
