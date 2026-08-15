'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { ScopedMemoryStats } from '@/actions/memory';
import { sourceLabel } from '@/lib/memory/source-labels';
import { cn } from '@/lib/utils';

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6 pb-5 text-center">
        <div className="metric text-3xl font-semibold">{value}</div>
        <div className="mt-1 text-xs font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function ScopeStats({
  stats,
  loading,
  source,
  onSourceChange,
}: {
  stats: ScopedMemoryStats | null;
  loading: boolean;
  /**
   * The by-mode row is the SOURCE CONTROL, not a legend.
   *
   * It used to be a row of non-interactive `<span>`s sitting directly beneath a
   * `Source` `<select>` that filtered the very same dimension — two controls
   * for one thing, and the more prominent one was not a control. The select is
   * gone; these chips took its job, and their counts are their own
   * discoverability.
   *
   * Omit both props to render the row read-only (the learner dashboard, where
   * filtering a knowledge model by answer mode is not a question anyone asks).
   */
  source?: string;
  onSourceChange?: (next: string | undefined) => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6 pb-5">
              <div className="mx-auto h-8 w-16 animate-pulse rounded bg-muted" />
              <div className="mx-auto mt-2 h-3 w-20 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Stats failed to load; the page has already surfaced the error via a toast,
  // so render nothing rather than a skeleton that never resolves.
  if (!stats) return null;

  const dash = (n: number | null, suffix = '') => (n === null ? '—' : `${n}${suffix}`);
  const interactive = typeof onSourceChange === 'function';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Tile label="Answers" value={stats.totalEvents.toLocaleString()} />
        <Tile label="Cards seen" value={stats.cardsSeen.toLocaleString()} />
        <Tile label="Accuracy" value={dash(stats.accuracy, '%')} hint="right / wrong" />
        <Tile label="Avg score" value={dash(stats.averageScore, '%')} hint="graded answers" />
        <Tile
          label="Avg confidence"
          value={dash(stats.averageConfidence)}
          hint={`${stats.masteredCards} mastered`}
        />
      </div>

      {stats.bySource.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">By mode:</span>

          {interactive && (
            <button
              type="button"
              aria-pressed={!source}
              onClick={() => onSourceChange(undefined)}
              className={cn(
                'inline-flex min-h-7 items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                !source ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-muted',
              )}
            >
              All
            </button>
          )}

          {stats.bySource.map((row) => {
            const label = sourceLabel(row.source);
            const active = source === row.source;
            const content = (
              <>
                {label}
                <span
                  className={cn(
                    'font-mono tabular-nums',
                    active ? 'opacity-80' : 'text-muted-foreground',
                  )}
                >
                  {row.count}
                </span>
              </>
            );

            if (!interactive) {
              return (
                <span
                  key={row.source}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
                >
                  {content}
                </span>
              );
            }

            return (
              <button
                key={row.source}
                type="button"
                aria-pressed={active}
                aria-label={`Show only ${label}`}
                // Clicking the active mode clears it, so the control can always
                // be undone without hunting for the All chip.
                onClick={() => onSourceChange(active ? undefined : row.source)}
                className={cn(
                  'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input hover:bg-muted',
                )}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
