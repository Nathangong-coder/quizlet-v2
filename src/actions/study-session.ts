'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { summarizeSession, type SessionItem, type SessionComputed } from '@/lib/memory/summarize';
import { SESSION_INSIGHT_VERSION, SessionInsightSchema, type SessionInsight } from '@/lib/memory/insight';
import type { StudySource } from '@/lib/memory/scoring';
import type { ActionResult } from '@/types/action';
import { generateJson } from '@/lib/ai/generate';
import { safeProfileBlock } from '@/lib/ai/context';
import { SESSION_INSIGHT_PROMPT } from '@/lib/ai/prompts/registry';

export const STUDY_SESSION_KINDS = ['quiz', 'matching', 'confidence'] as const;
export type StudySessionKind = (typeof STUDY_SESSION_KINDS)[number];

export async function startStudySession(input: {
  setId: string;
  kind: StudySessionKind;
  itemCount: number;
  categoryIds?: string[];
}): Promise<ActionResult<{ sessionId: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  // The kind reaches the DB as a plain string column, so it is validated here
  // rather than trusted from the client.
  if (!STUDY_SESSION_KINDS.includes(input.kind)) {
    return { success: false, error: 'Unknown study session kind' };
  }

  try {
    const created = await prisma.studySession.create({
      data: {
        userId: session.user.id,
        setId: input.setId,
        kind: input.kind,
        itemCount: input.itemCount,
        categoryIds: input.categoryIds ?? undefined,
      },
    });
    return { success: true, data: { sessionId: created.id } };
  } catch (error) {
    console.error('startStudySession error:', error);
    return { success: false, error: 'Failed to start study session' };
  }
}

/**
 * Closes a session, computes its deterministic insight, and persists it.
 *
 * Idempotent: a session that already carries an `endedAt` is returned as-is.
 * Quiz submit paths can fire this more than once (an overall submit plus a
 * navigation-away handler), and re-closing would otherwise inflate durations.
 */
export async function finishStudySession(input: {
  sessionId: string;
}): Promise<ActionResult<{ durationMs: number | null }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };
  const userId = session.user.id;

  try {
    // Scoped by userId: the id comes from the client and must never be
    // trusted on its own.
    const studySession = await prisma.studySession.findFirst({
      where: { id: input.sessionId, userId },
    });
    if (!studySession) return { success: false, error: 'Session not found' };

    if (studySession.endedAt) {
      return { success: true, data: { durationMs: studySession.durationMs } };
    }

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - studySession.startedAt.getTime();

    const events = await prisma.studyEvent.findMany({
      where: { userId, sessionId: studySession.id },
      include: {
        card: {
          select: {
            term: true,
            categoryAssignments: { select: { category: { select: { name: true } } } },
          },
        },
      },
    });

    const items: SessionItem[] = events.map((e) => ({
      cardId: e.cardId,
      term: e.card.term,
      source: e.source as StudySource,
      correct: e.correct,
      score: e.score,
      confidenceBefore: e.confidenceBefore,
      confidenceAfter: e.confidenceAfter,
      latencyMs: e.latencyMs,
      categoryNames: e.card.categoryAssignments.map((a) => a.category.name),
    }));

    // AI stays null here for every kind. Quizzes get their narrative from
    // generateSessionInsight, which the caller invokes after this resolves —
    // an AI failure must never leave a session unclosed.
    const insight: SessionInsight = {
      version: SESSION_INSIGHT_VERSION,
      computed: summarizeSession(items),
      ai: null,
    };

    await prisma.studySession.update({
      where: { id: studySession.id },
      data: { endedAt, durationMs, insight, insightAt: endedAt },
    });

    return { success: true, data: { durationMs } };
  } catch (error) {
    console.error('finishStudySession error:', error);
    return { success: false, error: 'Failed to finish study session' };
  }
}

/**
 * Adds the AI narrative to a session that already has a computed insight.
 *
 * Split from `finishStudySession` deliberately: closing a session must never
 * depend on an AI call succeeding. This is invoked after the finish resolves,
 * and by the "Generate insights" button on sessions that never got one.
 */
export async function generateSessionInsight(input: {
  sessionId: string;
}): Promise<ActionResult<{ generated: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    // Scoped by userId: the id comes from the client and must never be
    // trusted on its own — matches finishStudySession above.
    const studySession = await prisma.studySession.findFirst({
      where: { id: input.sessionId, userId: session.user.id },
      include: { set: { select: { title: true } } },
    });
    if (!studySession) return { success: false, error: 'Session not found' };

    // Parsed rather than cast: a blob written by an older version must not be
    // half-read into a new-shaped prompt.
    const parsed = SessionInsightSchema.safeParse(studySession.insight);
    if (!parsed.success) {
      return { success: false, error: 'Session has no computed insight yet' };
    }

    const profileBlock = await safeProfileBlock(
      session.user.id,
      studySession.setId,
      'session-insight',
    );

    const ai = await generateJson({
      userId: session.user.id,
      task: 'grade',
      prompt: SESSION_INSIGHT_PROMPT.build({
        setTitle: studySession.set.title,
        kind: studySession.kind,
        // SessionComputedSchema mirrors SessionComputed's shape but widens
        // `mode` to `string` for parsing tolerance; the value was written by
        // summarizeSession, which only ever emits StudySource literals, so
        // narrowing back is sound.
        computed: parsed.data.computed as SessionComputed,
        profileBlock,
      }),
      schema: SESSION_INSIGHT_PROMPT.schema,
    });

    // The computed block is carried through by spread, never re-derived —
    // the AI writes prose onto `ai`, it does not touch `computed`.
    await prisma.studySession.update({
      where: { id: studySession.id },
      data: {
        insight: { ...parsed.data, ai },
        insightAt: new Date(),
      },
    });

    return { success: true, data: { generated: true } };
  } catch (error) {
    console.error('generateSessionInsight error:', error);
    return { success: false, error: 'Failed to generate insights' };
  }
}
