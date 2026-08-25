'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loadTuning, saveTuning } from '@/actions/learner-tuning';
import { DEFAULT_THRESHOLDS, MASTERY_TOPIC_RANKS_MAX, type MetricThresholds } from '@/lib/tuning/schema';

type FieldKey = keyof MetricThresholds;

/** Mirrors `ThresholdOverridesSchema` exactly. Rejected, never clamped. */
const FIELDS: {
  key: FieldKey;
  label: string;
  copy: string;
  valid: (n: number) => boolean;
  error: string;
}[] = [
  {
    key: 'minObservations',
    label: 'Evidence before an opinion',
    copy:
      "How many times a point must be tested before we'll say whether you know it. Lowering this does not produce more evidence — it lowers the bar for acting on what exists, and a knowledge figure computed from one answer is a guess with a number attached. An interview next week justifies acting on thinner evidence than one six months out.",
    valid: (n) => Number.isInteger(n) && n >= 1 && n <= 50,
    error: 'Evidence floor must be a whole number from 1 to 50.',
  },
  {
    key: 'articulationMinPKnown',
    label: 'Confidence before blaming expression',
    copy:
      'How well you must know a point before a short answer that is too brief is treated as an expression problem rather than a knowledge gap. Below this, brevity is read as not knowing the material.',
    valid: (n) => Number.isFinite(n) && n >= 0 && n <= 1,
    error: 'Articulation confidence must be between 0 and 1.',
  },
  {
    key: 'readinessWeightPerAnswer',
    label: 'Readiness strictness',
    copy:
      'The average per-answer error weight at which readiness reaches zero. Lower is stricter.',
    valid: (n) => Number.isFinite(n) && n > 0 && n <= 100,
    error: 'Readiness weight must be above 0 and at most 100.',
  },
  {
    key: 'masteryTopicRanks',
    label: 'Topics counted per learning point',
    copy:
      "Each learning point is filed under one or two concepts, most central first. This is how many of them count toward a topic's mastery score. At 2, a point can mark both its concepts weak on a single wrong answer. At 1, each point counts exactly once under its main concept — a sharper diagnosis that takes longer to fill in.",
    valid: (n) => Number.isInteger(n) && n >= 1 && n <= MASTERY_TOPIC_RANKS_MAX,
    error: `Topics counted must be a whole number from 1 to ${MASTERY_TOPIC_RANKS_MAX}.`,
  },
];

type Draft = Record<FieldKey, string>;

function draftFrom(overrides: Partial<MetricThresholds>): Draft {
  return {
    minObservations: String(overrides.minObservations ?? DEFAULT_THRESHOLDS.minObservations),
    articulationMinPKnown: String(
      overrides.articulationMinPKnown ?? DEFAULT_THRESHOLDS.articulationMinPKnown,
    ),
    readinessWeightPerAnswer: String(
      overrides.readinessWeightPerAnswer ?? DEFAULT_THRESHOLDS.readinessWeightPerAnswer,
    ),
    masteryTopicRanks: String(
      overrides.masteryTopicRanks ?? DEFAULT_THRESHOLDS.masteryTopicRanks,
    ),
  };
}

/** Sparse: only fields that differ from the shipped default are stored. */
function overridesFrom(draft: Draft): Partial<MetricThresholds> {
  const out: Partial<MetricThresholds> = {};
  for (const field of FIELDS) {
    const n = Number(draft[field.key]);
    if (!Number.isFinite(n) || n === DEFAULT_THRESHOLDS[field.key]) continue;
    out[field.key] = n;
  }
  return out;
}

export default function MetricThresholdPanel() {
  const [draft, setDraft] = useState<Draft>(() => draftFrom({}));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await loadTuning();
      if (result.success) setDraft(draftFrom(result.data.thresholdOverrides));
      else toast.error(result.error);
      setLoading(false);
    })();
  }, []);

  async function save(next: Draft) {
    for (const field of FIELDS) {
      if (!field.valid(Number(next[field.key]))) {
        toast.error(field.error);
        return;
      }
    }
    setSaving(true);
    // ONLY thresholdOverrides, for the same reason the other two panels send
    // only their own field.
    const result = await saveTuning({ thresholdOverrides: overridesFrom(next) });
    setSaving(false);
    if (result.success) {
      setDraft(draftFrom(result.data.thresholdOverrides));
      toast.success('Metric thresholds saved');
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Metric thresholds</CardTitle>
        <CardDescription>
          How much evidence the app waits for before it will describe what you know, and how
          strictly it judges expression.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : (
          <>
            {FIELDS.map((field) => {
              const shipped = DEFAULT_THRESHOLDS[field.key];
              const changed = Number(draft[field.key]) !== shipped;
              return (
                <div key={field.key} className="space-y-1.5 pb-4 border-b last:border-b-0 last:pb-0">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={field.key}
                      value={draft[field.key]}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      className="w-24 h-8"
                      inputMode="decimal"
                    />
                    <span className="text-xs text-muted-foreground">default {shipped}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, [field.key]: String(shipped) }))
                      }
                      disabled={!changed}
                    >
                      Reset
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{field.copy}</p>
                </div>
              );
            })}

            <Button onClick={() => save(draft)} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save thresholds'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
