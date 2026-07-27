'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { ScopedMemoryStats } from '@/actions/memory';
import { SOURCE_LABELS } from './ScopeBar';

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6 pb-5 text-center">
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        <div className="mt-1 text-xs font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function ScopeStats({
  stats,
  loading,
}: {
  stats: ScopedMemoryStats | null;
  loading: boolean;
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
          {stats.bySource.map((row) => (
            <span
              key={row.source}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
            >
              {SOURCE_LABELS[row.source] ?? row.source}
              <span className="tabular-nums text-muted-foreground">{row.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
