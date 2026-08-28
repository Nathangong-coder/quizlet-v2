import Link from 'next/link'
import { CategoryChip } from '@/components/cards/CategoryChip'
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
    <article className="flex gap-4 min-w-0">
      <Link
        href={`/sets/${entry.id}`}
        tabIndex={-1}
        aria-hidden="true"
        className="shrink-0 text-primary/70 pt-1"
      >
        <SetGlyph setId={entry.id} categoryCount={entry.categories.length} className="w-12 h-12" />
      </Link>

      <div className="min-w-0 flex-1">
        <h3 className="text-base font-medium leading-snug">
          <Link href={`/sets/${entry.id}`} className="hover:underline underline-offset-4">
            {entry.title}
          </Link>
        </h3>

        {entry.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{entry.description}</p>
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
          <p className="text-xs text-muted-foreground mt-1">
            Copied from {entry.forkedFromTitle}
            {entry.forkedFromHandle && ` by @${entry.forkedFromHandle}`}
          </p>
        )}

        {entry.categories.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {entry.categories.map((c) => (
              <CategoryChip key={c.name} name={c.name} color={c.color} />
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2">
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
      </div>
    </article>
  )
}
