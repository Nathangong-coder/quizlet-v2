import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * One figure with its label.
 *
 * NULL IS NOT ZERO, and this component exists mainly to enforce that. A `0`
 * where there is no evidence reads as "you know none of this" — a different
 * and false claim from "nobody has measured this yet". The same rule already
 * governs `SetStudySummary.averageConfidence` and
 * `LearnerTopicProfile.knowledge`; scattering the ternary across every caller
 * is how one of them eventually renders the zero.
 *
 * The figure carries `.metric` (font-mono + tabular-nums, defined in
 * globals.css) so a column of values never reflows as they change.
 */
export function Metric({
  value,
  unit,
  label,
  emptyLabel = '—',
  className,
}: {
  value: number | null
  unit?: string
  label: string
  /** What to show instead of a figure when `value` is null. */
  emptyLabel?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <div className="flex items-baseline gap-1.5">
        {value === null ? (
          <span className="text-muted-foreground text-lg">{emptyLabel}</span>
        ) : (
          <>
            <span className="metric text-2xl leading-none">{value}</span>
            {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
          </>
        )}
      </div>
      <span className="label">{label}</span>
    </div>
  )
}
