'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SelectableChip } from '@/components/ui/selectable-chip';
import { UNCATEGORIZED_ID } from '@/lib/cards/categories';
import { isConsolidated, type HistoryScope } from '@/lib/memory/scope';
import type { MemoryFilterOptions } from '@/actions/memory';

export const SOURCE_LABELS: Record<string, string> = {
  review: 'Review',
  'quiz-mc': 'Quiz (Multiple Choice)',
  'quiz-sa': 'Quiz (Short Answer)',
  'quiz-tf': 'Quiz (True/False)',
  matching: 'Matching Game',
  lesson: 'Lesson',
};

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function ScopeBar({
  options,
  scope,
  onChange,
}: {
  options: MemoryFilterOptions;
  scope: HistoryScope;
  onChange: (next: HistoryScope) => void;
}) {
  const soleSetId = scope.setIds.length === 1 ? scope.setIds[0] : undefined;
  const consolidated = isConsolidated(scope);

  // A selected category may not appear in `options` if it was renamed or
  // deleted since the URL was written. Surface it anyway so it can be cleared.
  const categoryKeys = new Set(options.categories.map((c) => c.key));
  const orphanKeys = scope.categoryKeys.filter(
    (key) => key !== UNCATEGORIZED_ID && !categoryKeys.has(key),
  );

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Scope</h2>
            <p className="text-xs text-muted-foreground">
              {consolidated
                ? 'Showing everything across all sets.'
                : 'Showing a filtered slice of your history.'}
            </p>
          </div>
          {!consolidated && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ setIds: [], categoryKeys: [] })}
            >
              Clear
            </Button>
          )}
        </div>

        {options.sets.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Sets</span>
            <div className="flex flex-wrap gap-2">
              {options.sets.map((set) => (
                <SelectableChip
                  key={set.id}
                  label={set.title}
                  selected={scope.setIds.includes(set.id)}
                  onToggle={() => {
                    const setIds = toggle(scope.setIds, set.id);
                    // The card dropdown only exists for a single set, so any
                    // change that leaves one selected set invalidates it.
                    const keepCard = setIds.length === 1 && setIds[0] === soleSetId;
                    onChange({ ...scope, setIds, cardId: keepCard ? scope.cardId : undefined });
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {(options.categories.length > 0 || orphanKeys.length > 0) && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Categories <span className="opacity-70">(across all sets)</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {options.categories.map((category) => (
                <SelectableChip
                  key={category.key}
                  // The name alone: the span below and the count are decoration
                  // and should not be read as part of the control's name.
                  label={category.name}
                  selected={scope.categoryKeys.includes(category.key)}
                  color={category.color}
                  count={category.cardCount}
                  onToggle={() =>
                    onChange({ ...scope, categoryKeys: toggle(scope.categoryKeys, category.key) })
                  }
                >
                  {category.name}
                  {category.setIds.length > 1 && (
                    <span className="ml-1 text-xs opacity-70">· {category.setIds.length} sets</span>
                  )}
                </SelectableChip>
              ))}
              <SelectableChip
                label="Uncategorized"
                selected={scope.categoryKeys.includes(UNCATEGORIZED_ID)}
                onToggle={() =>
                  onChange({ ...scope, categoryKeys: toggle(scope.categoryKeys, UNCATEGORIZED_ID) })
                }
              />
              {orphanKeys.map((key) => (
                <SelectableChip
                  key={key}
                  label={`${key} (removed)`}
                  selected
                  onToggle={() =>
                    onChange({ ...scope, categoryKeys: toggle(scope.categoryKeys, key) })
                  }
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4 pt-1">
          <div className="flex flex-col gap-1">
            <label htmlFor="scope-source" className="text-xs font-medium text-muted-foreground">
              Source
            </label>
            <select
              id="scope-source"
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={scope.source ?? ''}
              onChange={(e) => onChange({ ...scope, source: e.target.value || undefined })}
            >
              <option value="">All sources</option>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="scope-card" className="text-xs font-medium text-muted-foreground">
              Card
            </label>
            <select
              id="scope-card"
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm disabled:opacity-50"
              value={scope.cardId ?? ''}
              disabled={!soleSetId}
              title={soleSetId ? undefined : 'Select exactly one set to filter by card'}
              onChange={(e) => onChange({ ...scope, cardId: e.target.value || undefined })}
            >
              <option value="">All cards</option>
              {options.cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.term}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
