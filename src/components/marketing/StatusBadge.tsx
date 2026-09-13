import { cn } from '@/lib/utils'
import type { Feature } from '@/lib/marketing/features'

/**
 * "Coming" on an unbuilt feature, or the feature's own badge text when it is
 * partly built (Games). Renders nothing for a plainly live feature, so a
 * badge is always a claim about status and never decoration.
 */
export function StatusBadge({ feature, className }: { feature: Feature; className?: string }) {
  if (feature.status === 'live' && !feature.badge) return null
  const text = feature.badge ?? 'Coming'
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium',
        feature.status === 'coming' ? 'bg-warning-subtle text-warning' : 'bg-accent text-accent-foreground',
        className,
      )}
    >
      {text}
    </span>
  )
}
