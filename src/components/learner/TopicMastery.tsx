'use client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import type { LearnerTopicProfile } from '@/lib/memory/topic-profile';

/** |verbosityIndex| below this reads as calibrated rather than a real lean. */
const VERBOSITY_SPEAK_THRESHOLD = 4;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * A null metric renders its own state, NEVER a zero. "Not enough data" is not
 * "knows nothing", and rendering null as 0% tells a learner they are failing a
 * topic they have simply not been quizzed on.
 */
function Metric({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="min-w-[5.5rem]">
      <p className="text-xs text-muted-foreground">{label}</p>
      {value === null ? (
        <p className="text-sm text-muted-foreground italic">not measured</p>
      ) : (
        <p className="text-lg font-semibold tabular-nums">{pct(value)}</p>
      )}
    </div>
  );
}

/**
 * Spec 3C §3. Knowledge against articulation, kept on separate axes.
 *
 * Collapsing them into one "mastery %" would destroy the distinction the whole
 * substrate exists to draw: high knowledge with low articulation is
 * short-answer practice, low on both is a lesson, and a single number cannot
 * tell those apart.
 */
export default function TopicMastery({
  topics,
  floor,
  heading = 'Topic mastery',
  blurb,
  breadcrumbs,
}: {
  topics: LearnerTopicProfile[];
  floor: number;
  /** Overridden by the auto-detected (KLT) axis, which renders the same rows. */
  heading?: string;
  /** Replaces the default explanation; the floor sentence is always appended. */
  blurb?: string;
  /**
   * Ancestor display names for each topic, keyed by `LearnerTopicProfile.key`
   * (root first, excluding self). OPTIONAL and KLT-axis only — the
   * user-authored category axis has no tree position and passes nothing here,
   * so its rows are unaffected.
   */
  breadcrumbs?: Record<string, string[]>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
        <CardDescription>
          {blurb ??
            'What you know, and how well you can say it. Kept apart on purpose — knowing a topic and being able to articulate it under pressure are different problems with different fixes.'}{' '}
          A topic reports knowledge once {floor} answer{floor === 1 ? '' : 's'} have landed on one
          of its key points.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {topics.length === 0 ? (
          <p className="text-sm text-muted-foreground">No topics in this view.</p>
        ) : (
          topics.map((topic) => {
            const breadcrumb = breadcrumbs?.[topic.key];
            return (
              <div
                key={topic.key}
                className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border p-3"
              >
                <div className="flex items-center gap-2 min-w-[10rem]">
                  {topic.color && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: topic.color }}
                      data-testid={`topic-color-${topic.key}`}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium truncate">{topic.name}</p>
                    {breadcrumb && breadcrumb.length > 0 && (
                      <p
                        className="text-xs text-muted-foreground truncate"
                        data-testid={`topic-breadcrumb-${topic.key}`}
                      >
                        {breadcrumb.join(' › ')}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {topic.klpCount} key point{topic.klpCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                <Metric value={topic.knowledge} label="Knowledge" />
                <Metric value={topic.readiness} label="Articulation" />
                <Verbosity topic={topic} />
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The signed index as a diverging bar, calibrated at centre.
 *
 * A topic whose `too_terse` tags were excluded for low pKnown is labelled a
 * KNOWLEDGE GAP rather than shown as neutral: no articulation signal *because
 * the learner does not know the material* is not the same as well calibrated,
 * and reading it as neutral would route them to expression practice they do
 * not need.
 */
function Verbosity({ topic }: { topic: LearnerTopicProfile }) {
  if (topic.knowledgeGapTerseness > 0 && Math.abs(topic.verbosityIndex) <= VERBOSITY_SPEAK_THRESHOLD) {
    return (
      <div className="min-w-[9rem]">
        <p className="text-xs text-muted-foreground">Verbosity</p>
        <p className="text-sm">Knowledge gap</p>
        <p className="text-xs text-muted-foreground">
          Short answers here look like not knowing it, not under-explaining it.
        </p>
      </div>
    );
  }

  const index = topic.verbosityIndex;
  const label =
    index > VERBOSITY_SPEAK_THRESHOLD
      ? 'Over-explains'
      : index < -VERBOSITY_SPEAK_THRESHOLD
        ? 'Under-explains'
        : 'Calibrated';

  // Saturate the bar well before the index runs away, so one extreme topic
  // does not flatten every other bar into invisibility.
  const magnitude = Math.min(1, Math.abs(index) / 20);

  return (
    <div className="min-w-[9rem]">
      <p className="text-xs text-muted-foreground">Verbosity</p>
      <p className="text-sm">{label}</p>
      <div className="relative mt-1 h-1.5 w-32 rounded-full bg-muted">
        <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
        <span
          className="absolute top-0 h-full rounded-full bg-primary"
          style={{
            width: `${magnitude * 50}%`,
            left: index >= 0 ? '50%' : undefined,
            right: index < 0 ? '50%' : undefined,
          }}
        />
      </div>
    </div>
  );
}
