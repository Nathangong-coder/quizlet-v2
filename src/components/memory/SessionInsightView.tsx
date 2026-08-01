'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { generateSessionInsight } from '@/actions/study-session';
import type { SessionInsight } from '@/lib/memory/insight';

export function SessionInsightView({
  insight,
  sessionId,
  canGenerate,
}: {
  insight: SessionInsight | null;
  sessionId: string | null;
  /** False for matching/confidence sessions, which get no AI narrative by design. */
  canGenerate: boolean;
}) {
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    if (!sessionId) return;
    setGenerating(true);
    const result = await generateSessionInsight({ sessionId });
    setGenerating(false);
    if (result.success) window.location.reload();
    else toast.error(result.error || 'Could not generate insights');
  }

  const generateButton = (
    <Button onClick={handleGenerate} disabled={generating} variant="outline">
      {generating ? 'Generating…' : 'Generate insights'}
    </Button>
  );

  if (!insight) {
    // A null insight means the stored blob failed to parse — typically an
    // older schema version. Regeneration is exactly the remedy, so offer it
    // here rather than leaving the user on a dead end. Matching/confidence
    // sessions (canGenerate === false) get no AI narrative by design, so a
    // button there would just be a different kind of dead end.
    if (canGenerate && sessionId) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">No breakdown saved for this activity.</p>
          {generateButton}
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground">No breakdown saved for this activity.</p>;
  }

  const { computed, ai } = insight;
  const hasCategory = computed.byCategory.length > 0;
  const hasMode = computed.byMode.length > 0;
  const hasPacing = computed.pacing.medianLatencyMs !== null;
  const hasAnyComputed = hasCategory || hasMode || hasPacing;

  return (
    <div className="space-y-6">
      {/* Focus areas first — they are the "where do I improve" answer. */}
      {ai ? (
        <section className="space-y-3">
          <h3 className="font-semibold">Focus areas</h3>
          {ai.focusAreas.map((area, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium">{area.title}</span>
                <span className="text-xs uppercase text-muted-foreground">{area.severity}</span>
              </div>
              <p className="text-sm text-muted-foreground">{area.evidence}</p>
              <p className="text-sm">{area.action}</p>
            </div>
          ))}
          {ai.strengths && <p className="text-sm text-muted-foreground">{ai.strengths}</p>}
        </section>
      ) : canGenerate && sessionId ? (
        generateButton
      ) : null}

      {hasAnyComputed ? (
        <section className="grid gap-6 sm:grid-cols-3">
          {hasCategory && (
            <div>
              <h4 className="text-sm font-semibold mb-2">By category</h4>
              {computed.byCategory.map((c) => (
                <div key={c.name} className="flex justify-between text-sm">
                  <span>{c.name}</span>
                  <span className="text-muted-foreground">{c.accuracyPct}%</span>
                </div>
              ))}
            </div>
          )}
          {hasMode && (
            <div>
              <h4 className="text-sm font-semibold mb-2">By mode</h4>
              {computed.byMode.map((m) => (
                <div key={m.mode} className="flex justify-between text-sm">
                  <span>{m.mode}</span>
                  <span className="text-muted-foreground">
                    {m.correct}/{m.total}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div>
            <h4 className="text-sm font-semibold mb-2">Pacing</h4>
            <p className="text-sm text-muted-foreground">
              {/* Null means "not measured" — legacy activities render an em dash
                  rather than a fabricated zero. */}
              median{' '}
              {computed.pacing.medianLatencyMs === null
                ? '—'
                : `${Math.round(computed.pacing.medianLatencyMs / 100) / 10}s`}
            </p>
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">No breakdown recorded for this activity.</p>
      )}
    </div>
  );
}
