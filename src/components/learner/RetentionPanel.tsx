'use client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ForgettingCurve } from '@/lib/metrics/forgetting';
import type { Misconception } from '@/lib/metrics/misconceptions';
import { sourceLabel } from '@/lib/memory/source-labels';

export interface PaceRow {
  cardId: string;
  mode: string;
  index: number;
  term?: string;
}

/**
 * Spec 3C §3. Retention and pace.
 *
 * The curve is EMPIRICAL — bucketed observations, not a fitted exponential —
 * so it is rendered as buckets with their sample sizes. A bucket built from
 * two pairs must not look as authoritative as one built from forty, which is
 * why `total` is always on screen.
 */
export function RetentionPanel({
  forgetting,
  paceOutliers,
}: {
  forgetting: ForgettingCurve | null;
  paceOutliers: PaceRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Retention and pace</CardTitle>
        <CardDescription>
          How well recall holds up as time passes, and where you are correct but not yet fluent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">Recall by gap since last seen</p>
          {!forgetting || forgetting.buckets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Not enough repeat exposures yet — this needs the same card seen twice.
            </p>
          ) : (
            <>
              {forgetting.buckets.map((b) => (
                <div key={b.label} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-muted-foreground">{b.label}</span>
                  <div className="h-2 flex-1 rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${Math.round(b.recallRate * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right tabular-nums">
                    {Math.round(b.recallRate * 100)}%{' '}
                    <span className="text-muted-foreground">({b.total})</span>
                  </span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                {forgetting.halfLifeDays === null
                  ? 'Half-life needs a bucket on each side of 50% recall before it means anything.'
                  : `Recall passes 50% at roughly ${forgetting.halfLifeDays.toFixed(1)} days.`}
              </p>
            </>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Correct but not fluent</p>
          {paceOutliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is running slow right now.</p>
          ) : (
            paceOutliers.map((p) => (
              <div
                key={`${p.cardId}-${p.mode}`}
                className="flex items-center justify-between gap-3 rounded-lg border p-2 text-sm"
              >
                <span className="truncate">{p.term ?? p.cardId}</span>
                {/* The mode is not decoration: each outlier is scored against
                    that mode's OWN baseline, so a figure without its mode is
                    not comparable to the one beside it. */}
                <span className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline">{sourceLabel(p.mode)}</Badge>
                  <span className="tabular-nums text-muted-foreground">
                    {p.index.toFixed(1)}× your usual
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export interface MisconceptionRow extends Misconception {
  label?: string;
}

/**
 * Promoted conflation pairs. Retirement state stays VISIBLE so a learner can
 * watch one decay rather than wondering why it vanished — a misconception that
 * silently disappears reads as a bug, not as progress.
 */
export function MisconceptionList({ misconceptions }: { misconceptions: MisconceptionRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active misconceptions</CardTitle>
        <CardDescription>
          Pairs of ideas you have mixed up more than once. These retire on their own once you stop
          confusing them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {misconceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None detected. This needs the same two ideas confused across more than one session.
          </p>
        ) : (
          misconceptions.map((m) => (
            <div
              key={`${m.klpId}-${m.secondaryKlpId}`}
              className={`rounded-lg border p-3 space-y-1 ${m.active ? '' : 'opacity-60'}`}
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{m.label ?? 'Conflated pair'}</p>
                {!m.active && (
                  <Badge variant="outline">
                    {m.retiredReason === 'cleared' ? 'Cleared' : 'Stale'}
                  </Badge>
                )}
              </div>
              {m.evidenceSnippet && (
                // Verbatim, never regenerated: a paraphrase of the learner's
                // own words is evidence of nothing.
                <p className="text-sm text-muted-foreground italic">
                  &ldquo;{m.evidenceSnippet}&rdquo;
                </p>
              )}
              <p className="text-xs text-muted-foreground tabular-nums">
                {m.occurrences} time{m.occurrences === 1 ? '' : 's'} across {m.sessionCount}{' '}
                session{m.sessionCount === 1 ? '' : 's'}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
