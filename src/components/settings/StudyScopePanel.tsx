'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import { loadTuning, saveTuning } from '@/actions/learner-tuning';
import { listMemoryFilterOptions, type MemoryFilterOptions } from '@/actions/memory';
import { UNCATEGORIZED_ID } from '@/lib/cards/categories';

const NO_OPTIONS: MemoryFilterOptions = { sets: [], categories: [], cards: [] };

/**
 * Spec 3C §6. The learner's saved answer to "what am I working on right now?"
 *
 * ## Why the "Only test certain sets" checkbox is gone
 *
 * It existed to distinguish *ticked-and-empty* from *unticked*. But `[]` on
 * disk already means EVERYTHING, so ticked-and-empty had no representation —
 * saving it would have persisted the exact opposite of what the panel showed.
 * The panel therefore had to DETECT that state and block the save on it
 * (`emptySets` / `emptyCategories` / `blocked`).
 *
 * A control whose only additional state is invalid should not exist. With the
 * checkbox removed, an empty selection reads "All sets", which is honest,
 * matches the stored zero value, and cannot be blocked — so the block logic is
 * deleted rather than maintained.
 *
 * The two dropdowns are the same control the scope line uses, so the setting
 * and the thing it sets no longer look like different features.
 */
export default function StudyScopePanel() {
  const [options, setOptions] = useState<MemoryFilterOptions>(NO_OPTIONS);
  const [setIds, setSetIds] = useState<string[]>([]);
  const [categoryKeys, setCategoryKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [tuning, filters] = await Promise.all([loadTuning(), listMemoryFilterOptions()]);
      if (tuning.success) {
        setSetIds(tuning.data.studyScope.setIds);
        setCategoryKeys(tuning.data.studyScope.categoryKeys);
      } else {
        toast.error(tuning.error);
      }
      if (filters.success) setOptions(filters.data);
      else toast.error(filters.error);
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    // ONLY studyScope. `saveTuning` leaves absent fields unchanged, so setting
    // a scope cannot wipe a band, a threshold, or the targeting strategy.
    const result = await saveTuning({ studyScope: { setIds, categoryKeys } });
    setSaving(false);
    if (result.success) {
      setSetIds(result.data.studyScope.setIds);
      setCategoryKeys(result.data.studyScope.categoryKeys);
      toast.success('Study scope saved');
    } else {
      toast.error(result.error);
    }
  }

  const setOptionsList: MultiSelectOption[] = options.sets.map((s) => ({
    value: s.id,
    label: s.title,
  }));

  const categoryOptionsList: MultiSelectOption[] = [
    // Categories span sets: the options are grouped on normalizedName, which is
    // the key this scope stores.
    ...options.categories.map((c) => ({
      value: c.key,
      label: c.name,
      color: c.color,
      count: c.cardCount,
    })),
    // A real bucket in `filterCardsByCategories`, not a filler option — and the
    // only one a learner with no categories can pick, which is exactly the
    // library the 3B live gate found.
    { value: UNCATEGORIZED_ID, label: 'Uncategorized' },
  ];

  const scoped = setIds.length > 0 || categoryKeys.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Study scope</CardTitle>
        <CardDescription>
          Which sets and categories the app should be working on right now. This narrows what it{' '}
          <strong>recommends</strong> and pre-selects — it never limits what you can study, and it
          never changes what gets recorded. Select nothing to use everything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <MultiSelect
                noun="sets"
                allLabel="All sets"
                options={setOptionsList}
                value={setIds}
                onChange={setSetIds}
                emptyText="You have no sets yet."
              />
              <MultiSelect
                noun="categories"
                allLabel="All categories"
                options={categoryOptionsList}
                value={categoryKeys}
                onChange={setCategoryKeys}
              />
            </div>

            <p className="text-sm text-muted-foreground">
              {scoped
                ? 'Recommendations and prefills will use this slice of your library.'
                : 'Using your whole library.'}
            </p>

            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save study scope'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
