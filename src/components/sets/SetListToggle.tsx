import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * Terms ↔ Key points, for the set's Study view.
 *
 * LINKS, not a client toggle. Which list you are reading is worth keeping in
 * the URL: it survives a refresh, it can be shared, and the KLP view's data is
 * loaded on the server, so a client-side switch would either fetch on click or
 * ship every card's relation graph to a reader who only wanted the terms.
 */
export function SetListToggle({ setId, current }: { setId: string; current: 'terms' | 'klp' }) {
  const options = [
    { key: 'terms' as const, href: `/sets/${setId}`, label: 'Terms' },
    { key: 'klp' as const, href: `/sets/${setId}?list=klp`, label: 'Key points' },
  ]

  return (
    <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="List view">
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          aria-current={current === o.key ? 'true' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            current === o.key
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  )
}
