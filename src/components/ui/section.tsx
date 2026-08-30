import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A ruled section — the shared study-desk layout's replacement for a shadcn `Card`
 * on list and detail surfaces.
 *
 * A hairline top rule and open space, not a bordered box with elevation. The
 * app's grid-of-shadowed-cards look is what makes it read as generic; a
 * broadsheet separates sections with rules and typography instead, which
 * carries hierarchy without drawing a container around every idea.
 *
 * `Card` is NOT deleted and remains correct where a thing really is a discrete
 * object you click (a set in a grid). This is for the containers AROUND those.
 */
export function Section({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('border-t border-border pt-4 mt-10 first:mt-0', className)}>
      {children}
    </section>
  )
}

export function SectionHeader({
  title,
  hint,
  action,
  className,
}: {
  title: string
  /** A short count or qualifier. Sits with the title, never below it. */
  hint?: string
  /** Right-aligned affordance — "See all", a filter, a menu. */
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 mb-4', className)}>
      <div className="flex items-baseline gap-3 min-w-0">
        <h2 className="font-heading text-xl tracking-tight truncate">{title}</h2>
        {hint && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">{hint}</span>
        )}
      </div>
      {action && <div className="shrink-0 text-sm">{action}</div>}
    </div>
  )
}

export function SectionBody({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn(className)}>{children}</div>
}
