'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { RankedCandidate } from '@/lib/metrics/targeting';
import type { StrategyKey } from '@/lib/tuning/schema';
import { UNCATEGORIZED_ID } from '@/lib/cards/categories';

const STRATEGY_LABELS: Record<StrategyKey, string> = {
  shore_up_weaknesses: 'Shore up weaknesses',
  polish_near_ready: "Polish what's nearly ready",
  follow_forgetting: 'Follow the forgetting curve',
  balanced: 'Balanced',
};

/** How many measured candidates to show before it stops being a shortlist. */
const MAX_SUFFICIENT = 12;
const MAX_UNMEASURED = 8;

export interface StudyNextRow extends RankedCandidate {
  /** The proposition itself, when the page could resolve it. */
  text?: string;
  /** The card it belongs to. */
  term?: string;
  /** Display name for the topic, falling back to the key. */
  topicName?: string;
}

/**
 * Spec 3C §3. Renders `LearnerMetrics.ranked` IN THE ORDER RECEIVED.
 *
 * Spec 3B already applied the learner's chosen strategy — a component that
 * re-sorts here would silently override a setting, and would look more correct
 * than it is (sorting by `score` descending is exactly the plausible mistake).
 * A test reorders the fixture and asserts the DOM follows.
 */
export default function StudyNext({
  ranked,
  strategy,
  floor,
}: {
  ranked: StudyNextRow[];
  strategy: StrategyKey;
  floor: number;
}) {
  // A FILTER, not a sort. `rankCandidates` already places every sub-threshold
  // candidate after every measured one; this only splits the list at the seam
  // it produced.
  const measured = ranked.filter((c) => c.sufficient);
  const unmeasured = ranked.filter((c) => !c.sufficient);

  return (
    <Card>
      <CardHeader>
        <CardTitle>What to study next</CardTitle>
        <CardDescription>
          Individual key points, not whole cards — the exact sub-claim you get wrong is the most
          actionable thing here. Ordered by{' '}
          <Link href="/settings/ai" className="text-primary hover:underline">
            {STRATEGY_LABELS[strategy]}
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">No study candidates in this view.</p>
        ) : (
          <>
            {measured.length > 0 && (
              <ol className="space-y-2" data-testid="measured-candidates">
                {measured.slice(0, MAX_SUFFICIENT).map((c) => (
                  <CandidateRow key={c.klpId} candidate={c} />
                ))}
              </ol>
            )}

            {unmeasured.length > 0 && (
              <div className="space-y-2">
                {/* Separated and labelled, NEVER interleaved. On a thin corpus
                    these are all tied at the prior, and presenting that tie as
                    a ranking invents a recommendation the evidence cannot
                    support. */}
                <p className="text-xs text-muted-foreground pt-2 border-t">
                  Not measured yet — fewer than {floor} answer{floor === 1 ? '' : 's'} each, so
                  these are listed, not ranked.
                </p>
                <ol className="space-y-2 opacity-70" data-testid="unmeasured-candidates">
                  {unmeasured.slice(0, MAX_UNMEASURED).map((c) => (
                    <CandidateRow key={c.klpId} candidate={c} />
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CandidateRow({ candidate }: { candidate: StudyNextRow }) {
  const uncategorized = candidate.topicKey === UNCATEGORIZED_ID;

  return (
    <li className="rounded-lg border p-3 space-y-1" data-klp-id={candidate.klpId}>
      <p className="text-sm">{candidate.text ?? candidate.term ?? 'Key point'}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">
          {uncategorized ? 'Uncategorized' : (candidate.topicName ?? candidate.topicKey)}
        </Badge>
        {candidate.term && candidate.text && <span className="truncate">{candidate.term}</span>}
        {candidate.sufficient && (
          <span className="tabular-nums">
            {Math.round(candidate.pKnown * 100)}% known · {candidate.observations} answers
          </span>
        )}
      </div>
    </li>
  );
}
