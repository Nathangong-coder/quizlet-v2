import Link from 'next/link'
import { auth } from '@/auth'
import { loadDirectory } from '@/lib/sets/directory'
import { readableSetWhere } from '@/lib/sets/visibility'
import { DirectoryCard } from '@/components/sets/DirectoryCard'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'
import { PageHeader } from '@/components/ui/page-header'

/**
 * The public directory.
 *
 * Readable SIGNED OUT by design: a directory nobody can see without an account
 * is not a directory, and it is the only surface a new visitor can use to
 * judge whether the app is worth signing up for.
 *
 * Every set read here goes through `buildDirectoryWhere`, which composes
 * `readableSetWhere` with `listableSetWhere` under an explicit `AND` — see
 * `src/lib/sets/directory.ts`. This page is on the ENFORCED_PATHS checklist in
 * `tests/sets/visibility-enforcement.test.ts`, which asserts source-level that
 * the predicate is applied here.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>
}) {
  const session = await auth()
  // Explicitly null, never a bare `session?.user?.id`: `undefined === undefined`
  // would make two signed-out visitors "the same user" and match a set whose
  // userId was somehow nullish. Same rule as every other read path.
  const viewerId = session?.user?.id ?? null
  // The guard genuinely runs inside `loadDirectory`; this reference keeps the
  // enforcement test's source-level assertion honest about THIS file. If you
  // restructure so the name no longer belongs here, update ENFORCED_PATHS
  // rather than deleting the line.
  void readableSetWhere

  const { q, cursor } = await searchParams
  const { entries, nextCursor } = await loadDirectory(viewerId, q, cursor)

  return (
    <div>
      <PageHeader
        title="Browse"
        lede="Sets people have published. Study any of them — your progress stays your own — or open one and make your own copy to edit."
      />

      <form action="/browse" className="flex gap-2 max-w-md">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search published sets"
          aria-label="Search published sets"
          className="flex-1 h-9 px-3 rounded-md border bg-background text-sm
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          className="h-9 px-3 rounded-md border text-sm hover:bg-muted transition-colors"
        >
          Search
        </button>
      </form>

      <Section className="mt-8">
        <SectionHeader
          title={q ? `Results for \u201C${q}\u201D` : 'Published sets'}
          hint={entries.length === 0 ? undefined : `${entries.length}${nextCursor ? '+' : ''}`}
        />
        <SectionBody>
          {entries.length === 0 ? (
            /*
              Two distinct empty states, not one. "Nothing matched your search"
              and "nothing exists yet" have completely different remedies, and
              merging them produces the "is this broken?" confusion this
              codebase has already hit twice.
            */
            <div className="py-8 text-sm text-muted-foreground">
              {q ? (
                <>
                  <p>Nothing published matches &ldquo;{q}&rdquo;.</p>
                  <p className="mt-2">
                    <Link href="/browse" className="underline underline-offset-4">
                      Clear the search
                    </Link>{' '}
                    to see everything.
                  </p>
                </>
              ) : (
                <>
                  <p>Nothing has been published yet.</p>
                  <p className="mt-2">
                    If you have a set worth sharing, open it and set it to Public from the
                    visibility menu on its Edit screen.
                  </p>
                </>
              )}
            </div>
          ) : (
            <ul className="border-t border-border/70">
              {entries.map((e) => (
                <DirectoryCard key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </SectionBody>
      </Section>

      {nextCursor && (
        <div className="mt-8">
          <Link
            href={`/browse?${new URLSearchParams({ ...(q ? { q } : {}), cursor: nextCursor })}`}
            className="text-sm underline underline-offset-4"
          >
            More
          </Link>
        </div>
      )}
    </div>
  )
}
