'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { generateJson, resolveTaskModel, AiGenerationError } from '@/lib/ai/generate';
import {
  MULTIPLE_CHOICE_PROMPT,
  GRADE_SHORT_ANSWER_PROMPT,
  MC_FEEDBACK_PROMPT,
  ANNOTATION_PROMPT,
  QUIZ_SUMMARY_PROMPT,
} from '@/lib/ai/prompts/registry';
import {
  MultipleChoiceOptionsSchema,
  MultipleChoiceOptions,
  ShortAnswerGradeSchema,
  MultipleChoiceFeedbackSchema,
  AnnotationSchema
} from '@/lib/ai/schemas';
import { overallQuizScore } from '@/lib/quiz/scoring';
import { revalidatePath } from 'next/cache';
import { QuizSetup } from '@/lib/quiz/setup';
import { recordStudyEvent } from '@/lib/memory/record';
import { normalizeLatency } from '@/lib/memory/latency';
import { safeProfileBlock } from '@/lib/ai/context';
import { ActionResult } from '@/types/action';

export async function getOrGenerateMultipleChoiceOptions(
  cardId: string
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
    const model = await resolveTaskModel(session.user.id, 'distractors');

    if (model) {
      const cached = await prisma.quizOptionCache.findUnique({
        where: { cardId_model: { cardId, model } },
      });

      if (cached) {
        const options = MultipleChoiceOptionsSchema.parse(cached.options);
        return {
          success: true,
          data: {
            cardId,
            options: options.options,
            correctAnswer: options.correctAnswer,
            cacheHit: true,
            model,
          },
        };
      }
    }

    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) return { success: false, error: 'Card not found' };

    const set = await prisma.set.findUnique({
      where: { id: card.setId },
      include: { cards: true },
    });
    if (!set) return { success: false, error: 'Set not found' };

    const profileBlock = await safeProfileBlock(session.user.id, card.setId, 'MC distractors');

    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: set.cards, profileBlock });
    const options = await generateJson({
      userId: session.user.id,
      task: 'distractors',
      prompt,
      schema: MultipleChoiceOptionsSchema,
    });

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
    const optionsJson = options as any;
    await prisma.quizOptionCache.upsert({
      where: { cardId_model: { cardId, model } },
      create: { cardId, model, options: optionsJson },
      update: { options: optionsJson },
    });

    const responseData = {
      cardId,
      options: options.options,
      correctAnswer: options.correctAnswer,
      cacheHit: false,
      model,
    };

    return {
      success: true,
      data: responseData,
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

    // Replace only this card's answer *in this mode* (a card may also be
    // tested in another mode within the same attempt — keep those intact).
    await prisma.quizAnswer.deleteMany({
      where: {
        attemptId: input.attemptId,
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
}): Promise<ActionResult<{ isCorrect: boolean; score: number; feedback?: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const isCorrect = input.selectedOption === 'true';
  const score = isCorrect ? 100 : 0;

  try {
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: input.attemptId, userId: session.user.id },
      select: { sessionId: true },
    });

    // Replace only this card's answer *in this mode* (see MC note above).
    await prisma.quizAnswer.deleteMany({
      where: {
        attemptId: input.attemptId,
        cardId: input.cardId,
        mode: 'true-false',
      },
    });

    let feedback = isCorrect ? 'Correct!' : 'Incorrect.';
    const card = await prisma.card.findUnique({ where: { id: input.cardId } });
    if (card) {
      try {
        const prompt = MC_FEEDBACK_PROMPT.build({ card, selected: input.selectedOption, correct: 'true' });
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
        prompt: 'True/False',
        correctAnswer: 'true',
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
        source: 'quiz-tf',
        sessionId: attempt?.sessionId ?? undefined,
        outcome: { correct: isCorrect },
        meta: { latencyMs: input.latencyMs },
      });
    } catch (memErr) {
      console.error('recordStudyEvent failed for quiz-tf:', memErr);
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

    // Idempotent, but scoped to this mode so a card also tested in another
    // section keeps that section's answer. A re-submit replaces the prior
    // short-answer row instead of creating a second graded one.
    await prisma.quizAnswer.deleteMany({
      where: { attemptId: input.attemptId, cardId: input.cardId, mode: 'short-answer' },
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
  overallAnalysis: string;
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
        try {
          const parsed = MultipleChoiceOptionsSchema.parse(row.options);
          parsedByCard.set(row.cardId, { options: parsed.options, correctAnswer: parsed.correctAnswer });
        } catch (e) {
          console.error(`Failed to parse options for card ${row.cardId}:`, e);
        }
      }

      attempt.answers = attempt.answers.map(a => {
        if (a.mode === 'multiple-choice') {
          const cache = parsedByCard.get(a.cardId);
          if (cache) return { ...a, options: cache.options };
        }
        return a;
      });
    }

    let overallAnalysis = 'Analysis unavailable.';
    // Only spend an AI call when there's actually something to analyze.
    // An empty submission just scores 0 — no need to prompt the model.
    // Isolated in try/catch: the analysis is supplementary, so a missing
    // credential or a generation failure should degrade to the default
    // string above rather than failing the whole summary (same pattern as
    // safeProfileBlock).
    if (attempt.answers.length > 0) {
      try {
        const profileBlock = await safeProfileBlock(session.user.id, attempt.setId, 'quiz-summary analysis');

        const prompt = QUIZ_SUMMARY_PROMPT.build({
          setTitle: attempt.set.title,
          mode: attempt.mode,
          score: attempt.score,
          answers: attempt.answers.map(a => ({
            term: a.card.term,
            isCorrect: a.isCorrect,
            score: a.score,
            feedback: a.feedback,
          })),
          profileBlock,
        });

        const result = await generateJson({
          userId: session.user.id,
          task: 'grade',
          prompt,
          schema: QUIZ_SUMMARY_PROMPT.schema,
        });
        overallAnalysis = result.analysis;
      } catch (aiErr) {
        console.error('Quiz summary analysis generation failed:', aiErr);
      }
    }

    return {
      success: true,
      data: {
        attempt,
        overallAnalysis,
      },
    };
  } catch (error: any) {
    console.error('Summary generation error:', error);
    return { success: false, error: 'Failed to generate quiz summary' };
  }
}
