'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import {
  SELF_RATINGS,
  SELF_RATING_LABELS,
  isSelfRating,
  type SelfRating,
} from '@/lib/memory/self-rating'

/**
 * The one-tap self-rating (Spec 6 §5), shared by quiz, Review and the
 * diagnostic. A `radiogroup` of four segmented buttons; nothing is
 * pre-selected, because "unrated" is a real state (D4) and the server writes
 * NULL for it. Keys `1`-`4` select while `keyboard` is on — Review binds them
 * pre-flip and freezes the picker (`disabled`) after the flip, so the answer
 * keys `1`/`2` never share the screen with the rating keys.
 *
 * Design-system tokens only; no new colours. Targets are ≥44 px (`min-h-11`)
 * and the four wrap to 2×2 on narrow screens.
 */
export interface SelfRatingPickerProps {
  value: SelfRating | null
  onChange: (v: SelfRating) => void
  /** Frozen after the flip in Review. */
  disabled?: boolean
  /**
   * Bind `1`-`4` on `window` while mounted (ignored inside inputs/textareas)
   * and show the key hint under each option. Review only: the quiz renders
   * every section stacked on one page, so a window-level key would rate the
   * current card in every section at once.
   */
  keyboard?: boolean
  /** "How sure are you?" (quiz, default) / "Do you know this one?" (Review). */
  prompt?: string
  className?: string
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function SelfRatingPicker({
  value,
  onChange,
  disabled = false,
  keyboard = false,
  prompt = 'How sure are you?',
  className,
}: SelfRatingPickerProps) {
  useEffect(() => {
    if (!keyboard || disabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTextEntry(e.target)) return
      const n = Number(e.key)
      if (!isSelfRating(n)) return
      e.preventDefault()
      onChange(n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard, disabled, onChange])

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-sm font-medium text-muted-foreground" aria-hidden="true">
        {prompt}
      </p>
      <div
        role="radiogroup"
        aria-label={prompt}
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
      >
        {SELF_RATINGS.map((r) => {
          const selected = value === r
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={SELF_RATING_LABELS[r]}
              disabled={disabled}
              onClick={() => onChange(r)}
              className={cn(
                'flex min-h-11 flex-1 flex-col items-center justify-center rounded-lg border px-3 py-1.5',
                'text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                'disabled:pointer-events-none disabled:opacity-60',
                selected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-input bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span className="font-medium leading-tight">{SELF_RATING_LABELS[r]}</span>
              {keyboard && !disabled && (
                <span className="mt-0.5 font-mono text-[10px] leading-none opacity-70" aria-hidden="true">
                  {r}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
