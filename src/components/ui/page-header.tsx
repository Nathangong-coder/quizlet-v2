import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * The top of a page: title, one line of orientation, and any page-level action.
 *
 * Exists because "generic AI CRUD app" is a LAYOUT problem before it is a token
 * problem — every surface here was a centered column of equal-weight cards
 * where nothing was more important than anything else. A shared header is the
 * cheapest way to give every page one thing that is unambiguously first.
 *
 * The `.display` and `.lede` classes come from the Instrument chassis
 * (globals.css); this component's job is the arrangement, not the type.
 */
export function PageHeader({
  title,
  lede,
  action,
  className,
}: {
  title: string
  /** One sentence. If it needs two, it belongs in the page body. */
  lede?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="display">{title}</h1>
        {/* `max-w-prose`, not the page measure: a lede that runs the full width
            of a 72rem shell is a line too long to track back from. */}
        {lede && <p className="lede mt-3 max-w-prose">{lede}</p>}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  )
}

/**
 * One setting: what it is on the left, the control on the right.
 *
 * The single biggest density win available on the settings pages, which were a
 * vertical stack of full-width `Card`s — each one a heading, a description and
 * a control, boxed and shadowed, so four settings filled a screen and the page
 * read as a form nobody had finished designing.
 *
 * Stacks below `sm`, where two columns would leave the control ~120px wide.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: {
  label: string
  description?: React.ReactNode
  /** When the control has a single focusable input, name it so the label binds. */
  htmlFor?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid gap-3 border-t border-border py-5 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:gap-8',
        className,
      )}
    >
      <div className="min-w-0">
        {/* A plain <p> when nothing is bound: a <label> pointing at nothing is
            a lie to a screen reader, and several of these wrap a whole control
            group rather than one input. */}
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium">{label}</p>
        )}
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
