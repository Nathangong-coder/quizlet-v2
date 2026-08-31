import Link from 'next/link'
import { SetGlyph } from '@/components/sets/SetGlyph'
import type { DirectoryEntry } from '@/lib/sets/directory'

/**
 * One row of the public directory.
 *
 * A server component with no interactivity of its own — the fork action lives
 * on the set's own page, not here. A "Make my own copy" button on a directory
 * row would start an expensive blob-duplicating operation from a list the
 * reader is skimming, before they have seen a single card.
 */
export function DirectoryCard({ entry }: { entry: DirectoryEntry }) {
  return (
    <li className="group flex min-w-0 items-center gap-3 border-b border-border/70 py-3 sm:gap-4 sm:py-4">
      <Link
        href={`/sets/${entry.id}`}
        aria-label={`Open ${entry.title}`}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/[0.07] text-primary/70 transition-colors group-hover:bg-primary/10 sm:h-11 sm:w-11"
      >
        <SetGlyph setId={entry.id} categoryCount={0} className="h-7 w-7 sm:h-8 sm:w-8" />
      </Link>

      <Link href={`/sets/${entry.id}`} className="min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <h3 className="truncate text-base font-semibold leading-snug tracking-tight transition-colors group-hover:text-primary sm:text-lg">{entry.title}</h3>

        {entry.description && (
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{entry.description}</p>
        )}

        {/*
          Attribution renders from the DENORMALIZED fields, never from the live
          FK, and never as a link here (design §7.3). Linking would require
          re-authorizing the source against this viewer, which is one extra
          query per row in a paginated list; the set's own page does that and
          can afford it. Plain text asserts nothing about whether the source
          still exists or is still readable.
        */}
        {entry.forkedFromTitle && (
          <p className="mt-1 text-xs text-muted-foreground">
            Copied from {entry.forkedFromTitle}
            {entry.forkedFromHandle && ` by @${entry.forkedFromHandle}`}
          </p>
        )}

        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="metric">{entry.cardCount}</span>
          <span>{entry.cardCount === 1 ? 'card' : 'cards'}</span>
          {/*
            A null handle renders NO credit rather than a fallback. `User.name`
            is the OAuth provider's real-name field and must never reach a
            public surface. The publish gate requires a handle, but that is
            validation checked once — not an invariant — so this must degrade
            rather than assume. Deliberately NOT filtered out of the directory
            query: that would hide a published set for a reason its owner can
            neither see nor fix.
          */}
          {entry.handle && (
            <>
              <span aria-hidden="true">·</span>
              <span>@{entry.handle}</span>
            </>
          )}
          {entry.forkCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                <span className="metric">{entry.forkCount}</span>{' '}
                {entry.forkCount === 1 ? 'copy' : 'copies'}
              </span>
            </>
          )}
        </p>
      </Link>
    </li>
  )
}
