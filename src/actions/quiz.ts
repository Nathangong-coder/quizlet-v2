'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { generateJsonWithGoogle, generateJsonMultimodal } from '@/lib/ai/google';
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
import { modelFor } from '@/lib/ai/model-routing';
import { overallQuizScore } from '@/lib/quiz/scoring';
import { revalidatePath } from 'next/cache';
import { QuizSetup } from '@/lib/quiz/setup';
import { recordStudyEvent } from '@/lib/memory/record';
import { buildLearnerProfile } from '@/lib/memory/profile';
import { profileToPromptBlock } from '@/lib/ai/context';

/**
 * Builds a rendered LearnerProfile block for prompt injection, isolated so a
 * failure never breaks the AI call it's meant to enrich (same
 * error-isolation pattern as recordStudyEvent call sites below).
 */
async function safeProfileBlock(userId: string, setId: string, label: string): Promise<string | undefined> {
  try {
    const profile = await buildLearnerProfile({ userId, setId });
    return profileToPromptBlock(profile);
  } catch (err) {
    console.error(`buildLearnerProfile failed for ${label}:`, err);
    return undefined;
  }
}

type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function getOrGenerateMultipleChoiceOptions(
  cardId: string
): Promise<ActionResult<{ cardId: string; options: string[]; correctAnswer: string; cacheHit: boolean; model: string }>> {
  if (!cardId) return { success: false, error: 'Card ID is required' };
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const model = modelFor('distractors');

  try {
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

    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) return { success: false, error: 'Card not found' };

    const set = await prisma.set.findUnique({
      where: { id: card.setId },
      include: { cards: true },
    });
    if (!set) return { success: false, error: 'Set not found' };

    const credential = await prisma.aiCredential.findUnique({
      where: { userId: session.user.id },
    });
    if (!credential) return { success: false, error: 'No Google API key saved. Please add it in settings.' };

    const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
    const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);

    const profileBlock = await safeProfileBlock(session.user.id, card.setId, 'MC distractors');

    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: set.cards, profileBlock });
    const options = await generateJsonWithGoogle({
      apiKey,
      prompt,
      schema: MultipleChoiceOptionsSchema,
      model,
    });

    await prisma.quizOptionCache.create({
      data: {
        cardId,
        model,
        options: options as any,
      },
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
  } catch (error: any) {
    console.error('Quiz generation error:', error);
    return { success: false, error: 'Failed to generate quiz options.' };
  }
}

export async function startQuizAttempt(
  setId: string,
  modes: ('multiple-choice' | 'short-answer' | 'matching' | 'true-false')[],
  setup: QuizSetup,
  questionCount?: number,
  timerSeconds?: number
): Promise<ActionResult<{ attemptId: string; cardIds: string[] }>> {
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

    const attempt = await prisma.quizAttempt.create({
      data: {
        userId: session.user.id,
        setId,
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
    return { success: true, data: { attemptId: attempt.id, cardIds: selectedIds } };
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
}): Promise<ActionResult<{ isCorrect: boolean; score: number; feedback?: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const isCorrect = input.selectedOption.trim().toLowerCase() === input.correctAnswer.trim().toLowerCase();
  const score = isCorrect ? 100 : 0;

  try {
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
      const credential = await prisma.aiCredential.findUnique({ where: { userId: session.user.id } });
      if (credential) {
        const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
        const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);
        const prompt = MC_FEEDBACK_PROMPT.build({ card, selected: input.selectedOption, correct: input.correctAnswer });
        const aiResult = await generateJsonWithGoogle({
          apiKey,
          prompt,
          schema: MultipleChoiceFeedbackSchema,
          model: modelFor('distractors'),
        });
        feedback = aiResult.feedback;
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
        feedback,
      },
    });

    try {
      await recordStudyEvent({
        userId: session.user.id,
        cardId: input.cardId,
        source: 'quiz-mc',
        outcome: { correct: isCorrect },
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
}): Promise<ActionResult<{ isCorrect: boolean; score: number; feedback?: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const isCorrect = input.selectedOption === 'true';
  const score = isCorrect ? 100 : 0;

  try {
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
      const credential = await prisma.aiCredential.findUnique({ where: { userId: session.user.id } });
      if (credential) {
        const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
        const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);
        const prompt = MC_FEEDBACK_PROMPT.build({ card, selected: input.selectedOption, correct: 'true' });
        const aiResult = await generateJsonWithGoogle({
          apiKey,
          prompt,
          schema: MultipleChoiceFeedbackSchema,
          model: modelFor('distractors'),
        });
        feedback = aiResult.feedback;
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
        feedback,
      },
    });

    try {
      await recordStudyEvent({
        userId: session.user.id,
        cardId: input.cardId,
        source: 'quiz-tf',
        outcome: { correct: isCorrect },
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
}): Promise<ActionResult<{ grade: any; score: number }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
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

    const credential = await prisma.aiCredential.findUnique({
      where: { userId: session.user.id },
    });
    if (!credential) return { success: false, error: 'No Google API key saved. Please add it in settings.' };

    const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
    const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);

    const gradeModel = modelFor('grade');
    const profileBlock = await safeProfileBlock(session.user.id, card.setId, 'short-answer grading');

    // Get content blocks for the term side (what the user was asked about)
    const termBlocks = card.contentBlocks
      .filter(b => b.side === 'term')
      .sort((a, b) => a.position - b.position);

    // Use text-only path if no media
    if (termBlocks.every(b => b.type === 'text')) {
      const prompt = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: input.answer, profileBlock });
      const grade = await generateJsonWithGoogle({
        apiKey,
        prompt,
        schema: ShortAnswerGradeSchema,
        model: gradeModel,
      });

      let annotations: any[] = [];
      try {
        const annPrompt = ANNOTATION_PROMPT.build({ card, answer: input.answer, correct: card.definition, profileBlock });
        const annResult = await generateJsonWithGoogle({
          apiKey,
          prompt: annPrompt,
          schema: AnnotationSchema,
          model: gradeModel,
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
          feedback: grade.summary,
        },
      });

      try {
        await recordStudyEvent({
          userId: session.user.id,
          cardId: input.cardId,
          source: 'quiz-sa',
          outcome: { overall: grade.overall },
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
    const grade = await generateJsonMultimodal({
      apiKey,
      parts,
      schema: ShortAnswerGradeSchema,
      model: gradeModel,
    });

    let annotations: any[] = [];
    try {
      const annPrompt = ANNOTATION_PROMPT.build({ card, answer: input.answer, correct: card.definition, profileBlock });
      const annResult = await generateJsonWithGoogle({
        apiKey,
        prompt: annPrompt,
        schema: AnnotationSchema,
        model: gradeModel,
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
        feedback: grade.summary,
      },
    });

    try {
      await recordStudyEvent({
        userId: session.user.id,
        cardId: input.cardId,
        source: 'quiz-sa',
        outcome: { overall: grade.overall },
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
  } catch (error: any) {
    console.error('Grading error:', error);
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

    // Fetch MC options for answers that are multiple-choice
    const mcAnswers = attempt.answers.filter(a => a.mode === 'multiple-choice');
    if (mcAnswers.length > 0) {
      const cardIds = mcAnswers.map(a => a.cardId);
      const cachedOptions = await prisma.quizOptionCache.findMany({
        where: {
          cardId: { in: cardIds },
          model: modelFor('distractors'),
        },
      });

      attempt.answers = attempt.answers.map(a => {
        if (a.mode === 'multiple-choice') {
          const cache = cachedOptions.find(c => c.cardId === a.cardId);
          if (cache) {
            try {
              const parsed = MultipleChoiceOptionsSchema.parse(cache.options);
              return { ...a, options: parsed.options };
            } catch (e) {
              console.error(`Failed to parse options for card ${a.cardId}:`, e);
            }
          }
        }
        return a;
      });
    }

    const credential = await prisma.aiCredential.findUnique({ where: { userId: session.user.id } });
    let overallAnalysis = 'Analysis unavailable.';
    // Only spend an AI call when there's actually something to analyze.
    // An empty submission just scores 0 — no need to prompt the model.
    if (credential && attempt.answers.length > 0) {
      const { decryptGoogleApiKey } = await import('@/lib/security/google-key');
      const apiKey = decryptGoogleApiKey(credential.encryptedApiKey);

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

      const result = await generateJsonWithGoogle({
        apiKey,
        prompt,
        schema: QUIZ_SUMMARY_PROMPT.schema,
        model: modelFor('grade'),
      });
      overallAnalysis = result.analysis;
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
