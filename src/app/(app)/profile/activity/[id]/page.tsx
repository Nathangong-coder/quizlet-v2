import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { getStudySession } from '@/actions/study-session';
import { SessionInsightView } from '@/components/memory/SessionInsightView';
import { QuizSummary } from '@/components/quiz/QuizSummary';
import { ResetQuizButton } from '@/components/memory/ResetQuizButton';
import { activityLabel, formatDuration } from '@/lib/memory/activity-labels';

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getStudySession(id);
  if (!result.success || !result.data) notFound();

  const activity = result.data;

  return (
    <div className="max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{activityLabel(activity.kind)}</h1>
        <p className="text-sm text-muted-foreground">
          {activity.setTitle} · {format(activity.startedAt, 'MMM d, h:mma')} ·{' '}
          {activity.itemCount} items · {formatDuration(activity.durationMs)}
        </p>
      </header>

      {activity.kind === 'quiz' && activity.attemptId ? (
        // The identical component the live end-of-quiz screen renders, so the
        // permalink IS "the page I saw when I finished" rather than a copy of
        // it that can drift.
        <>
          <QuizSummary setId={activity.setId} attemptId={activity.attemptId} canReset />
          <ResetQuizButton attemptId={activity.attemptId} setId={activity.setId} />
        </>
      ) : (
        <SessionInsightView
          insight={activity.insight}
          sessionId={activity.id}
          // Matching and Confidence Ranking get the computed block only.
          canGenerate={false}
        />
      )}
    </div>
  );
}
