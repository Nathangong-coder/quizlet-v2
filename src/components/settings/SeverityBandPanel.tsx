'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadTuning, saveTuning } from '@/actions/learner-tuning';
import { DEFAULT_BANDS, type SeverityBand } from '@/lib/errors/bands';
import { ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES, type Dimension } from '@/lib/errors/taxonomy';
import { CORRUPTION_SEVERITY } from '@/lib/errors/severity';
import { labelForErrorType } from '@/lib/errors/labels';

const GROUPS: { dimension: Dimension; label: string; types: readonly string[] }[] = [
  { dimension: 'accuracy', label: 'Accuracy', types: ACCURACY_TYPES },
  { dimension: 'clarity', label: 'Clarity', types: CLARITY_TYPES },
  { dimension: 'conciseness', label: 'Conciseness', types: CONCISENESS_TYPES },
];

/**
 * The types whose CEILING also governs multiple-choice and true/false scoring.
 *
 * Derived from `CORRUPTION_SEVERITY` rather than listed here: those are exactly
 * the corruptions a distractor can be generated from, so a corruption added
 * later gets the warning automatically instead of silently missing it.
 */
const PINNED_CEILING_TYPES = new Set<string>(Object.keys(CORRUPTION_SEVERITY));

/** The two inputs as typed, so a half-finished edit is not reformatted mid-keystroke. */
type Draft = Record<string, { floor: string; ceiling: string }>;

function draftFrom(overrides: Record<string, SeverityBand>): Draft {
  const draft: Draft = {};
  for (const group of GROUPS) {
    for (const type of group.types) {
      const band = overrides[type] ?? DEFAULT_BANDS[type];
      draft[type] = { floor: String(band[0]), ceiling: String(band[1]) };
    }
  }
  return draft;
}

/**
 * Only types that DIFFER from the shipped default are sent, keeping the stored
 * blob sparse — an untouched type keeps tracking future default changes rather
 * than being frozen at today's value.
 */
function overridesFrom(draft: Draft): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const [type, value] of Object.entries(draft)) {
    const floor = Number(value.floor);
    const ceiling = Number(value.ceiling);
    const shipped = DEFAULT_BANDS[type];
    if (!Number.isFinite(floor) || !Number.isFinite(ceiling)) {
      out[type] = [floor, ceiling];
      continue;
    }
    if (shipped && floor === shipped[0] && ceiling === shipped[1]) continue;
    out[type] = [floor, ceiling];
  }
  return out;
}

/** Mirrors `BandOverridesSchema` exactly. Rejected, never clamped. */
function firstInvalid(draft: Draft): string | null {
  for (const [type, value] of Object.entries(draft)) {
    const floor = Number(value.floor);
    const ceiling = Number(value.ceiling);
    const whole = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
    if (!whole(floor) || !whole(ceiling)) {
      return `${labelForErrorType(type)} needs two whole numbers from 1 to 5.`;
    }
    if (floor > ceiling) {
      return `${labelForErrorType(type)}: the first number must not be larger than the second.`;
    }
  }
  return null;
}

export default function SeverityBandPanel() {
  const [draft, setDraft] = useState<Draft>(() => draftFrom({}));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await loadTuning();
      if (result.success) setDraft(draftFrom(result.data.bandOverrides));
      else toast.error(result.error);
      setLoading(false);
    })();
  }, []);

  function update(type: string, patch: Partial<{ floor: string; ceiling: string }>) {
    setDraft((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }));
  }

  function resetType(type: string) {
    const shipped = DEFAULT_BANDS[type];
    update(type, { floor: String(shipped[0]), ceiling: String(shipped[1]) });
  }

  async function save(next: Draft) {
    const invalid = firstInvalid(next);
    if (invalid) {
      // Rejected, not clamped: silently fixing the number would show one value
      // while scoring used another.
      toast.error(invalid);
      return;
    }
    setSaving(true);
    // ONLY bandOverrides. `saveTuning` leaves absent fields unchanged, so this
    // panel neither knows nor overwrites what the other two hold.
    const result = await saveTuning({ bandOverrides: overridesFrom(next) });
    setSaving(false);
    if (result.success) {
      setDraft(draftFrom(result.data.bandOverrides));
      toast.success('Severity bands saved');
    } else {
      toast.error(result.error);
    }
  }

  function resetAll() {
    const cleared = draftFrom({});
    setDraft(cleared);
    void save(cleared);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Error severity bands</CardTitle>
        <CardDescription>
          How harshly each kind of mistake is scored. The two numbers are the mildest and the
          most severe an instance of that mistake can count as, on a 1–5 scale.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">
          Changing a band re-scores your history. These numbers are worked out fresh every time
          a screen loads, not frozen when you answered — so a retune changes what past answers
          scored. That&apos;s deliberate: if inversions are overweighted <em>for you</em>, you want the
          fix applied to everything, not just to what you do next. But it does mean a topic can
          move from weak to fine without you having studied anything.
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : (
          <>
            {GROUPS.map((group) => (
              <div key={group.dimension} className="space-y-3">
                <h3 className="text-sm font-medium">{group.label}</h3>
                {group.types.map((type) => {
                  const shipped = DEFAULT_BANDS[type];
                  const value = draft[type];
                  const changed =
                    value && (Number(value.floor) !== shipped[0] || Number(value.ceiling) !== shipped[1]);
                  return (
                    <div key={type} className="space-y-1 pb-3 border-b last:border-b-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm flex-1 min-w-40">{labelForErrorType(type)}</span>
                        <Input
                          aria-label={`${labelForErrorType(type)} mildest`}
                          value={value?.floor ?? ''}
                          onChange={(e) => update(type, { floor: e.target.value })}
                          className="w-16 h-8"
                          inputMode="numeric"
                        />
                        <span className="text-muted-foreground text-sm">to</span>
                        <Input
                          aria-label={`${labelForErrorType(type)} most severe`}
                          value={value?.ceiling ?? ''}
                          onChange={(e) => update(type, { ceiling: e.target.value })}
                          className="w-16 h-8"
                          inputMode="numeric"
                        />
                        <span className="text-xs text-muted-foreground w-24">
                          default {shipped[0]}–{shipped[1]}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resetType(type)}
                          disabled={!changed}
                        >
                          Reset
                        </Button>
                      </div>
                      {PINNED_CEILING_TYPES.has(type) && (
                        <p className="text-xs text-muted-foreground">
                          Also affects multiple choice and true/false. Those answers always resolve
                          to this type&apos;s <strong>upper</strong> number, so changing it re-scores every
                          multiple-choice and true/false {labelForErrorType(type).toLowerCase()}{' '}
                          you&apos;ve ever answered — not just your written ones.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            <div className="flex gap-2">
              <Button onClick={() => save(draft)} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save bands'}
              </Button>
              <Button variant="outline" onClick={resetAll} disabled={saving}>
                Reset all to defaults
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
