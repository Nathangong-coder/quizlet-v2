'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { loadTuning, saveTuning } from '@/actions/learner-tuning';
import { STRATEGY_KEYS, type StrategyKey } from '@/lib/tuning/schema';

const STRATEGY_COPY: Record<StrategyKey, { label: string; description: string }> = {
  shore_up_weaknesses: {
    label: 'Shore up weaknesses',
    description:
      'Targets what you know least, weighted by how central it is. Best when the interview is still some way off.',
  },
  polish_near_ready: {
    label: "Polish what's nearly ready",
    description:
      'Targets material you know but express poorly. Best when the interview is close.',
  },
  follow_forgetting: {
    label: 'Follow the forgetting curve',
    description: 'Targets what is due or overdue for review. Best for maintenance.',
  },
  balanced: {
    label: 'Balanced (default)',
    description: 'A blend of all three.',
  },
};

export default function TargetingStrategyPanel() {
  const [strategy, setStrategy] = useState<StrategyKey>('balanced');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await loadTuning();
      if (result.success) setStrategy(result.data.strategy);
      else toast.error(result.error);
      setLoading(false);
    })();
  }, []);

  async function save(next: StrategyKey) {
    setSaving(true);
    // ONLY strategy. `saveTuning` leaves absent fields unchanged, so selecting
    // a strategy cannot wipe a band or threshold override.
    const result = await saveTuning({ strategy: next });
    setSaving(false);
    if (result.success) {
      setStrategy(result.data.strategy);
      toast.success('Study targeting saved');
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Study targeting</CardTitle>
        <CardDescription>
          Which weaknesses to put in front of you first. This affects <strong>ordering only</strong> —
          never what gets recorded, and never the numbers themselves. Switching strategies shows
          you the same profile ranked differently, not a different profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">
          Not yet visible anywhere. The ranked study list this controls is built and saved, but
          the dashboard that displays it is still to come — so setting this now decides how that
          list will be ordered when it arrives, and changes nothing you can see today.
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : (
          <div className="space-y-2">
            {STRATEGY_KEYS.map((key) => {
              const copy = STRATEGY_COPY[key];
              const selected = strategy === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => save(key)}
                  disabled={saving}
                  aria-pressed={selected}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    selected ? 'border-primary bg-accent/40' : 'hover:bg-accent/20'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {copy.label}
                    {selected && saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {copy.description}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
