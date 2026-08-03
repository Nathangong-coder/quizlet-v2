'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
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
import { safeProfileBlock } from '@/lib/ai/context';
import { ActionResult } from '@/types/action';
import { SessionInsightSchema, type SessionInsight } from '@/lib/memory/insight';
import { ensureKlpsReady } from '@/actions/klp';
import { parseOptionCache, type ParsedOptions } from '@/lib/quiz/options';
import { pickTfVariant } from '@/lib/quiz/coin-flip';

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
 * Freezes the question as asked, with its KLP provenance. Spec 2 reads this to
 * diagnose a wrong pick with no grading call. Upsert because a user may
 * navigate back to a question before submitting. No-op without an attemptId
 * (e.g. the printable-quiz path, which has no attempt).
 *
 * Bookkeeping only: a failure here must never fail option generation, so
 * callers wrap this in try/catch and swallow.
 */
async function recordQuizQuestion(
  attemptId: string | undefined,
  cardId: string,
  parsed: ParsedOptions,
): Promise<void> {
  if (!attemptId) return;
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
          await recordQuizQuestion(attemptId, cardId, parsedCache);
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

    const set = await prisma.set.findUnique({
      where: { id: card.setId },
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
      await recordQuizQuestion(attemptId, cardId, parsed);
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
    const set = await prisma.set.findUnique({
      where: { id: setId },
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

    // Replace only this card's answer *in this mode* (a card may also be
    // tested in another mode within the same attempt — keep those intact).
    await prisma.quizAnswer.deleteMany({
      where: {
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        mode: 'multiple-choice',
      },
    });

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

    const answer = await prisma.quizAnswer.create({
      data: {
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
    });

    try {
      await recordStudyEvent({
        userId: session.user.id,
        cardId: input.cardId,
        source: 'quiz-mc',
        sessionId: attempt?.sessionId ?? undefined,
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

    // Unreachable given the one-shot guard above, but kept (and owner-scoped)
    // as a belt-and-braces idempotency guard against a partial prior write.
    await prisma.quizAnswer.deleteMany({
      where: {
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        mode: 'true-false',
      },
    });

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

    const answer = await prisma.quizAnswer.create({
      data: {
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
    });

    if (isCorrect !== null) {
      try {
        await recordStudyEvent({
          userId: session.user.id,
          cardId: input.cardId,
          source: 'quiz-tf',
          sessionId: attempt?.sessionId ?? undefined,
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

    // Idempotent, but scoped to this mode so a card also tested in another
    // section keeps that section's answer. A re-submit replaces the prior
    // short-answer row instead of creating a second graded one.
    await prisma.quizAnswer.deleteMany({
      where: {
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        mode: 'short-answer',
      },
    });

    const card = await prisma.card.findUnique({
      where: { id: input.cardId },
      include: { contentBlocks: true },
    });
    if (!card) return { success: false, error: 'Card not found' };

    const profileBlock = await safeProfileBlock(session.user.id, card.setId, 'short-answer grading');

    // Get content blocks for the term side (what the user was asked about)
    const termBlocks = card.contentBlocks
      .filter(b => b.side === 'term')
      .sort((a, b) => a.position - b.position);

    // Use text-only path if no media
    if (termBlocks.every(b => b.type === 'text')) {
      const prompt = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: input.answer, profileBlock });
      const grade = await generateJson({
        userId: session.user.id,
        task: 'grade',
        prompt,
        schema: ShortAnswerGradeSchema,
      });

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

      const answer = await prisma.quizAnswer.create({
        data: {
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
      });

      try {
        await recordStudyEvent({
          userId: session.user.id,
          cardId: input.cardId,
          source: 'quiz-sa',
          sessionId: attempt?.sessionId ?? undefined,
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

    const { parts } = GRADE_SHORT_ANSWER_PROMPT.buildParts({ card, promptBlocks: contentBlocks, answer: input.answer, profileBlock });

    // In a full implementation, assetToPart would be called here to add inlineData
    // For now, we just use the text parts as fallback
    const grade = await generateJson({
      userId: session.user.id,
      task: 'grade',
      parts,
      schema: ShortAnswerGradeSchema,
    });

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

    const answer = await prisma.quizAnswer.create({
      data: {
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
    });

    try {
      await recordStudyEvent({
        userId: session.user.id,
        cardId: input.cardId,
        source: 'quiz-sa',
        sessionId: attempt?.sessionId ?? undefined,
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
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
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
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        user: true,
        set: { include: { cards: true } },
        session: true,
        answers: {
          include: {
            card: { include: { contentBlocks: { orderBy: { position: 'asc' } } } },
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
