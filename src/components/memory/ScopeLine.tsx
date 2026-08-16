'use client'

import React from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select'
import { UNCATEGORIZED_ID } from '@/lib/cards/categories'
import { isConsolidated, type HistoryScope } from '@/lib/memory/scope'
import type { MemoryFilterOptions } from '@/actions/memory'
import { cn } from '@/lib/utils'

/** How many removable chips render before the rest collapse into a count. */
export const MAX_VISIBLE_CHIPS = 4

export interface ScopeChip {
  key: string
  label: string
  color?: string | null
  onRemove: () => void
  /** Exempt from the overflow cap. See `cardId` below. */
  pinned?: boolean
}

/**
 * Every active narrowing, as one flat removable list.
 *
 * Pure and exported so the capping rule is testable without a DOM.
 *
 * The card chip is `pinned`. It is the NARROWEST scope and subsumes set and
 * category entirely in `buildStudyEventWhere`, so it must never be the chip
 * that the overflow count swallows — with four sets selected a plain
 * `slice(0, MAX_VISIBLE_CHIPS)` would hide the only filter actually deciding
 * what the page shows, and the learner would be looking at one card's history
 * with nothing on screen saying so.
 */
export function scopeChips(
  scope: HistoryScope,
  options: MemoryFilterOptions,
  onChange: (next: HistoryScope) => void,
): ScopeChip[] {
  const chips: ScopeChip[] = []

  for (const id of scope.setIds) {
    const title = options.sets.find((s) => s.id === id)?.title ?? id
    chips.push({
      key: `set:${id}`,
      label: title,
      onRemove: () =>
        onChange({
          ...scope,
          setIds: scope.setIds.filter((s) => s !== id),
          // The card filter only ever meant anything within a single set.
          cardId: undefined,
        }),
    })
  }

  for (const key of scope.categoryKeys) {
    const category = options.categories.find((c) => c.key === key)
    chips.push({
      key: `cat:${key}`,
      // A category deleted or renamed since the URL was written still has to be
      // clearable, so it surfaces under its raw key rather than vanishing.
      label:
        key === UNCATEGORIZED_ID
          ? 'Uncategorized'
          : (category?.name ?? `${key} (removed)`),
      color: category?.color ?? null,
      onRemove: () =>
        onChange({ ...scope, categoryKeys: scope.categoryKeys.filter((c) => c !== key) }),
    })
  }

  if (scope.cardId) {
    const term = options.cards.find((c) => c.id === scope.cardId)?.term ?? 'this card'
    chips.push({
      key: `card:${scope.cardId}`,
      label: `Card: ${term}`,
      pinned: true,
      onRemove: () => onChange({ ...scope, cardId: undefined }),
    })
  }

  return chips
}

function RemovableChip({ chip }: { chip: ScopeChip }) {
  return (
    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-primary/40 bg-accent px-2.5 py-0.5 text-xs text-accent-foreground">
      {chip.color && (
        <span
          className="h-2 w-2 shrink-0 rounded-full ring-1 ring-border"
          style={{ backgroundColor: chip.color }}
          aria-hidden="true"
        />
      )}
      <span className="truncate max-w-[12rem]">{chip.label}</span>
      <button
        type="button"
        onClick={chip.onRemove}
        aria-label={`Remove ${chip.label} from scope`}
        className="-mr-1 rounded-full p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  )
}

export interface ScopeLineProps {
  options: MemoryFilterOptions
  scope: HistoryScope
  onChange: (next: HistoryScope) => void
  /** Right-aligned count, e.g. "312 answers". */
  summary?: React.ReactNode
  /**
   * Present only when the learner's SAVED study scope is what is in force.
   * Folds what were three separate affordances — a notice with a "Change it"
   * link, a "Show everything" button, and an editable chip panel showing the
   * same scope — into this one line.
   */
  savedScope?: { onShowEverything: () => void }
}

/**
 * One line, collapsed by default, replacing the `ScopeBar` panel.
 *
 * Two dimensions, not four. `source` moved to the Memory History feed, where it
 * is a view control rather than part of the scope; it is gone from the learner
 * dashboard entirely, because filtering a knowledge model to one answer mode
 * silently halves every posterior it touches. The card `<select>` is gone
 * outright — it was disabled unless exactly one set was chosen, a precondition
 * announced only in a `title` attribute, and card scope was always really
 * entered by clicking a term in the feed. It leaves via the chip below.
 */
export default function ScopeLine({
  options,
  scope,
  onChange,
  summary,
  savedScope,
}: ScopeLineProps) {
  const consolidated = isConsolidated(scope)
  const chips = scopeChips(scope, options, onChange)
  // Pinned chips are never candidates for the cap, so the cap applies to the
  // rest and the pinned ones are appended afterwards.
  const pinned = chips.filter((c) => c.pinned)
  const capped = chips.filter((c) => !c.pinned)
  const visible = [...capped.slice(0, MAX_VISIBLE_CHIPS), ...pinned]
  const hidden = capped.length - Math.min(capped.length, MAX_VISIBLE_CHIPS)

  const setOptions: MultiSelectOption[] = options.sets.map((s) => ({
    value: s.id,
    label: s.title,
  }))

  const categoryOptions: MultiSelectOption[] = [
    ...options.categories.map((c) => ({
      value: c.key,
      label: c.setIds.length > 1 ? `${c.name} · ${c.setIds.length} sets` : c.name,
      color: c.color,
      count: c.cardCount,
    })),
    // A real bucket in `filterCardsByCategories`, and the only option a learner
    // with no categories can pick.
    { value: UNCATEGORIZED_ID, label: 'Uncategorized' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5">
      <span className="text-sm text-muted-foreground">Showing</span>

      <MultiSelect
        noun="sets"
        allLabel="All sets"
        options={setOptions}
        value={scope.setIds}
        emptyText="You have no sets yet."
        onChange={(setIds) =>
          onChange({
            ...scope,
            setIds,
            // The card filter is only meaningful inside one set, so any change
            // that does not leave exactly that set selected invalidates it.
            cardId:
              setIds.length === 1 && setIds[0] === scope.setIds[0] ? scope.cardId : undefined,
          })
        }
      />

      <MultiSelect
        noun="categories"
        allLabel="All categories"
        options={categoryOptions}
        value={scope.categoryKeys}
        onChange={(categoryKeys) => onChange({ ...scope, categoryKeys })}
      />

      {visible.map((chip) => (
        <RemovableChip key={chip.key} chip={chip} />
      ))}
      {hidden > 0 && (
        <span className="text-xs text-muted-foreground">+{hidden} more</span>
      )}

      {!consolidated && (
        <button
          type="button"
          onClick={() => onChange({ setIds: [], categoryKeys: [] })}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Clear
        </button>
      )}

      {savedScope && (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-0.5">Saved scope</span>
          <button
            type="button"
            onClick={savedScope.onShowEverything}
            className="underline hover:text-foreground"
          >
            Show everything
          </button>
          <Link href="/settings/ai" className="underline hover:text-foreground">
            Edit default
          </Link>
        </span>
      )}

      {summary !== undefined && (
        <span className={cn('ml-auto text-xs text-muted-foreground')}>{summary}</span>
      )}
    </div>
  )
}
