'use client'

import React, { useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface MultiSelectOption {
  value: string
  label: string
  color?: string | null
  count?: number
}

export interface MultiSelectProps {
  /** Plural noun for the dimension, e.g. "sets". Used in the trigger label. */
  noun: string
  /** Shown on the trigger when nothing is selected, e.g. "All sets". */
  allLabel: string
  options: MultiSelectOption[]
  value: string[]
  onChange: (next: string[]) => void
  /** Show a filter box once the list is at least this long. */
  searchThreshold?: number
  emptyText?: string
  className?: string
}

/**
 * Collapsed multi-select. The replacement for chip rows that rendered every
 * option unconditionally — with 15 sets and 12 categories the old scope filter
 * was taller than the content it filtered, and had no disclosure of any kind.
 *
 * The trigger states what is selected so the current scope is legible without
 * opening anything.
 */
export function triggerLabel(
  value: string[],
  options: MultiSelectOption[],
  noun: string,
  allLabel: string,
): string {
  if (value.length === 0) return allLabel
  if (value.length === 1) {
    // A selection whose option has since been deleted or renamed still has to
    // read as something; falling through to the raw key beats rendering blank.
    return options.find((o) => o.value === value[0])?.label ?? value[0]
  }
  return `${value.length} ${noun}`
}

export function MultiSelect({
  noun,
  allLabel,
  options,
  value,
  onChange,
  searchThreshold = 8,
  emptyText = 'Nothing to choose from yet.',
  className,
}: MultiSelectProps) {
  const [query, setQuery] = useState('')

  const showSearch = options.length >= searchThreshold
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          value.length > 0
            ? 'border-primary/40 bg-accent text-accent-foreground'
            : 'border-input hover:bg-muted',
          className,
        )}
      >
        <span className="truncate max-w-[12rem]">
          {triggerLabel(value, options, noun, allLabel)}
        </span>
        {value.length > 1 && (
          <span className="font-mono text-xs tabular-nums opacity-70">{value.length}</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
      </PopoverTrigger>

      <PopoverContent>
        {showSearch && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${noun}…`}
            aria-label={`Filter ${noun}`}
            className="mb-2 h-8"
          />
        )}

        <div className="max-h-64 overflow-y-auto" role="group" aria-label={noun}>
          {options.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{emptyText}</p>
          ) : visible.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No {noun} match “{query}”.</p>
          ) : (
            visible.map((option) => {
              const selected = value.includes(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => toggle(option.value)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                    'transition-colors hover:bg-muted focus-visible:outline-none focus-visible:bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                    )}
                    aria-hidden="true"
                  >
                    {selected && <Check className="h-3 w-3" />}
                  </span>
                  {option.color && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full ring-1 ring-border"
                      style={{ backgroundColor: option.color }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.count !== undefined && (
                    // Hidden from the accessible name, as in SelectableChip: a
                    // card count is context, and letting it in makes the
                    // option announce as "accounting 12".
                    <span
                      className="font-mono text-xs tabular-nums text-muted-foreground"
                      aria-hidden="true"
                    >
                      {option.count}
                    </span>
                  )}
                </button>
              )
            })
          )}
        </div>

        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Clear {noun}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default MultiSelect
