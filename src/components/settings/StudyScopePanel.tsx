'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SelectableChip } from '@/components/ui/selectable-chip';
import { loadTuning, saveTuning } from '@/actions/learner-tuning';
import { listMemoryFilterOptions, type MemoryFilterOptions } from '@/actions/memory';
import { UNCATEGORIZED_ID } from '@/lib/cards/categories';

const NO_OPTIONS: MemoryFilterOptions = { sets: [], categories: [], cards: [] };

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * Spec 3C §6. The learner's saved answer to "what am I working on right now?"
 *
 * Two independent groups, each revealing its list when enabled. Unchecked means
 * everything, which is the stored zero value — so the checkbox is pure UI over
 * an empty array and there is no tri-state to persist.
 */
export default function StudyScopePanel() {
  const [options, setOptions] = useState<MemoryFilterOptions>(NO_OPTIONS);
  const [setIds, setSetIds] = useState<string[]>([]);
  const [categoryKeys, setCategoryKeys] = useState<string[]>([]);
  const [limitSets, setLimitSets] = useState(false);
  const [limitCategories, setLimitCategories] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [tuning, filters] = await Promise.all([loadTuning(), listMemoryFilterOptions()]);
      if (tuning.success) {
        const scope = tuning.data.studyScope;
        setSetIds(scope.setIds);
        setCategoryKeys(scope.categoryKeys);
        // The checkbox is DERIVED from the stored value on load rather than
        // stored itself: a non-empty list is the only thing "limited" can mean.
        setLimitSets(scope.setIds.length > 0);
        setLimitCategories(scope.categoryKeys.length > 0);
      } else {
        toast.error(tuning.error);
      }
      if (filters.success) setOptions(filters.data);
      else toast.error(filters.error);
      setLoading(false);
    })();
  }, []);

  // Ticked-with-nothing-selected cannot be stored: `[]` means EVERYTHING, so
  // saving it would persist the exact opposite of what the panel displays.
  // There is no third value to write, so the state is blocked rather than
  // guessed at.
  const emptySets = limitSets && setIds.length === 0;
  const emptyCategories = limitCategories && categoryKeys.length === 0;
  const blocked = emptySets || emptyCategories;

  async function save() {
    if (blocked) return;
    setSaving(true);
    // ONLY studyScope. `saveTuning` leaves absent fields unchanged, so setting
    // a scope cannot wipe a band, a threshold, or the targeting strategy.
    const result = await saveTuning({
      studyScope: {
        setIds: limitSets ? setIds : [],
        categoryKeys: limitCategories ? categoryKeys : [],
      },
    });
    setSaving(false);
    if (result.success) {
      const scope = result.data.studyScope;
      setSetIds(scope.setIds);
      setCategoryKeys(scope.categoryKeys);
      setLimitSets(scope.setIds.length > 0);
      setLimitCategories(scope.categoryKeys.length > 0);
      toast.success('Study scope saved');
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Study scope</CardTitle>
        <CardDescription>
          Which sets and categories the app should be working on right now. This narrows what it{' '}
          <strong>recommends</strong> and pre-selects — it never limits what you can study, and it
          never changes what gets recorded. Leave both unticked to use everything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : (
          <>
            <div className="space-y-2">
              <SelectableChip
                semantics="checkbox"
                selected={limitSets}
                onToggle={() => setLimitSets((v) => !v)}
                label="Only test certain sets"
              />
              {limitSets && (
                <div className="flex flex-wrap gap-2 pl-4 pt-1">
                  {options.sets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">You have no sets yet.</p>
                  ) : (
                    options.sets.map((s) => (
                      <SelectableChip
                        key={s.id}
                        semantics="checkbox"
                        selected={setIds.includes(s.id)}
                        onToggle={() => setSetIds((prev) => toggle(prev, s.id))}
                        label={s.title}
                      />
                    ))
                  )}
                </div>
              )}
              {emptySets && (
                <p className="text-sm text-destructive pl-4">
                  Pick at least one set, or untick the box to use every set.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <SelectableChip
                semantics="checkbox"
                selected={limitCategories}
                onToggle={() => setLimitCategories((v) => !v)}
                label="Only test certain categories"
              />
              {limitCategories && (
                <div className="flex flex-wrap gap-2 pl-4 pt-1">
                  {/* Categories span sets: the options are grouped on
                      normalizedName, which is the key this scope stores. */}
                  {options.categories.map((c) => (
                    <SelectableChip
                      key={c.key}
                      semantics="checkbox"
                      selected={categoryKeys.includes(c.key)}
                      onToggle={() => setCategoryKeys((prev) => toggle(prev, c.key))}
                      color={c.color}
                      label={c.name}
                      count={c.cardCount}
                    />
                  ))}
                  {/* A real bucket in `filterCardsByCategories`, not a filler
                      option — and the only one a learner with no categories can
                      pick, which is exactly the library the 3B gate found. */}
                  <SelectableChip
                    semantics="checkbox"
                    selected={categoryKeys.includes(UNCATEGORIZED_ID)}
                    onToggle={() => setCategoryKeys((prev) => toggle(prev, UNCATEGORIZED_ID))}
                    label="Uncategorized"
                  />
                </div>
              )}
              {emptyCategories && (
                <p className="text-sm text-destructive pl-4">
                  Pick at least one category, or untick the box to use every category.
                </p>
              )}
            </div>

            <Button onClick={save} disabled={saving || blocked}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save study scope'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
