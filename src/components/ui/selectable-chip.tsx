'use client'

import React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The one selectable chip.
 *
 * Four of these existed — `memory/ScopeBar`'s Chip, `settings/StudyScopePanel`'s
 * Choice, `sets/CategoryFilterBar`, and an inline one in `quiz/QuizSetupScreen`
 * — with three different active-state treatments and three different
 * accessibility contracts, one of which was absent entirely (a `<div onClick>`
 * wrapping a `readOnly` checkbox, not focusable and not announced). A learner
 * met a differently shaped control for the same idea on three screens.
 *
 * ## Why selection is an accent fill, not the category's own colour
 *
 * Two of the four tinted the chip with the user's category colour when active
 * (`backgroundColor: ${color}20` with that same colour as the TEXT). That was
 * already fragile and is now actively broken: dark mode is reachable as of the
 * token work, and a dark palette colour rendered as text over a 12%-alpha wash
 * of itself on a dark ground is unreadable. Selection therefore always uses the
 * accent, and the category's identity is carried by the colour DOT, which it
 * already was in two of the four.
 *
 * Selection is also never colour alone — a check mark appears (`color-not-only`).
 */
export interface SelectableChipProps {
  selected: boolean
  onToggle: () => void
  /**
   * The accessible name. Required even when `children` is supplied, because
   * several call sites render decoration (counts, "· 3 sets") that should not
   * become part of the announced name.
   */
  label: string
  children?: React.ReactNode
  /** The category's own colour, shown as a dot. Never used as text or fill. */
  color?: string | null
  /** Rendered muted after the label; excluded from the accessible name. */
  count?: number
  disabled?: boolean
  /**
   * `toggle` announces `aria-pressed` and suits a view filter; `checkbox`
   * announces `aria-checked` and suits a multi-select inside a form that saves.
   * Both are real `<button>`s, so keyboard behaviour is identical.
   */
  semantics?: 'toggle' | 'checkbox'
  className?: string
}

export function SelectableChip({
  selected,
  onToggle,
  label,
  children,
  color,
  count,
  disabled = false,
  semantics = 'toggle',
  className,
}: SelectableChipProps) {
  const isCheckbox = semantics === 'checkbox'

  return (
    <button
      type="button"
      role={isCheckbox ? 'checkbox' : undefined}
      aria-checked={isCheckbox ? selected : undefined}
      aria-pressed={isCheckbox ? undefined : selected}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5',
        'text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:pointer-events-none disabled:opacity-50',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-transparent hover:bg-muted',
        className,
      )}
    >
      {selected ? (
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        color && (
          <span
            className="h-2 w-2 shrink-0 rounded-full ring-1 ring-border"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
        )
      )}
      <span className="truncate max-w-[14rem]">{children ?? label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'font-mono text-xs tabular-nums',
            selected ? 'opacity-80' : 'text-muted-foreground',
          )}
          aria-hidden="true"
        >
          {count}
        </span>
      )}
    </button>
  )
}

export default SelectableChip
