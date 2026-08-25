'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MissedTopic, MissedKlp, MissedAnswer } from '@/lib/metrics/missed';

const MODE_LABELS: Record<string, string> = {
  'quiz-sa': 'Short answer',
  'quiz-mc': 'Multiple choice',
  'quiz-tf': 'True/false',
};

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * A null metric renders its own state, NEVER a zero — the same rule
 * `TopicMastery` follows. "Not enough data" is not "knows nothing", and
 * rendering null as 0% tells a learner they are failing a topic they have
 * simply not been measured on.
 */
function Knowledge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-sm text-muted-foreground italic">not measured</span>;
  }
  return <span className="text-sm font-semibold tabular-nums">{Math.round(value * 100)}%</span>;
}

/**
 * Spec §8. Aggregate weakness leads; the specific misses that produced it are
 * one click away.
 *
 * Either half alone is unusable. An aggregate nobody can check against a quiz
 * they remember taking is not trustworthy, and a raw feed of misses cannot
 * distinguish one unlucky answer from a real gap.
 */
export default function MissedWork({ topics, floor }: { topics: MissedTopic[]; floor: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What you&rsquo;re getting wrong</CardTitle>
        <CardDescription>
          The points you have actually missed, grouped by topic. Expand one to see the full
          statement and the attempts behind it. A topic reports knowledge once {floor} answer
          {floor === 1 ? '' : 's'} have landed on one of its points.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {topics.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing wrong to show yet — no quiz answer in this view has missed a key point.
          </p>
        ) : (
          topics.map((topic) => <TopicBlock key={topic.key} topic={topic} />)
        )}
      </CardContent>
    </Card>
  );
}

function TopicBlock({ topic }: { topic: MissedTopic }) {
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-medium">{topic.name}</p>
        <Badge variant="outline">
          {topic.missCount} miss{topic.missCount === 1 ? '' : 'es'}
        </Badge>
        <Knowledge value={topic.knowledge} />
      </div>
      <ul className="space-y-1.5">
        {topic.klps.map((klp) => (
          <KlpRow key={klp.klpId} klp={klp} />
        ))}
      </ul>
    </div>
  );
}

function KlpRow({ klp }: { klp: MissedKlp }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-md bg-muted/40 px-2.5 py-2" data-klp-id={klp.klpId}>
      {/* A real button, so it is keyboard-reachable and findable by role. */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        {/* The SHORT label leads. Falling back to the full proposition when
            the topic pass has not run keeps the summarizer from being a hard
            dependency of this panel. */}
        <span className="text-sm">{klp.label ?? klp.text}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {klp.misses.length}&times;
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <p className="text-sm text-muted-foreground">{klp.text}</p>
          <p className="text-xs text-muted-foreground">
            From <span className="font-medium">{klp.term}</span>
            {klp.pKnown !== null && ` · ${Math.round(klp.pKnown * 100)}% known`}
            {` · ${klp.observations} answer${klp.observations === 1 ? '' : 's'}`}
          </p>
          <ul className="space-y-1">
            {klp.misses.map((miss, i) => (
              <MissRow key={`${miss.klpId}-${i}`} miss={miss} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function MissRow({ miss }: { miss: MissedAnswer }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{formatDate(miss.createdAt)}</span>
      <span>{MODE_LABELS[miss.mode] ?? miss.mode}</span>
      <Badge variant={miss.status === 'failed' ? 'destructive' : 'secondary'}>{miss.status}</Badge>
      {miss.errorTypes.map((type) => (
        <Badge key={type} variant="outline">
          {type.replace(/_/g, ' ')}
        </Badge>
      ))}
    </li>
  );
}
