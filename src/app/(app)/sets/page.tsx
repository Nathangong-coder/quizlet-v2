import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { SetCard } from '@/components/sets/SetCard'
import { Button, buttonVariants } from '@/components/ui/button'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { SearchBar } from '@/components/search/SearchBar'
import { Suspense } from 'react'
import { cn } from '@/lib/utils'
import { SignInButton } from '@/components/auth/SignInButton'
import { loadSetStudySummaries } from '@/lib/sets/study-summary'
import { PageHeader } from '@/components/ui/page-header'

export default async function SetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await auth()
  const { q } = await searchParams

  if (!session?.user?.id) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <h2 className="text-2xl font-bold">Sign in to see your sets</h2>
        <p className="text-muted-foreground">You need an account to manage your flashcard sets.</p>
        <SignInButton className={cn(buttonVariants())} />
      </div>
    )
  }

  const whereClause: Prisma.SetWhereInput = {
    userId: session.user.id,
  }

  if (q) {
    whereClause.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      {
        cards: {
          some: {
            OR: [
              { term: { contains: q, mode: 'insensitive' } },
              { definition: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      },
    ]
  }

  const sets = await prisma.set.findMany({
    where: whereClause,
    include: {
      _count: {
        select: { cards: true },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  // One query for every set on the page rather than one per card. The list
  // could not previously answer "what should I open?" — it showed a title, a
  // card count and a creation date, none of which is study state.
  const summaries = await loadSetStudySummaries(
    prisma,
    session.user.id,
    sets.map((s) => s.id),
  )

  return (
    <div>
      <PageHeader
        title="Library"
        lede="Everything you have made or copied."
        action={
          <>
            <Suspense fallback={<div className="h-9 w-56 bg-muted animate-pulse rounded-md" />}>
              <SearchBar />
            </Suspense>
            <Link
              href="/sets/new"
              className={cn(buttonVariants(), 'flex items-center gap-2 whitespace-nowrap')}
            >
              <Plus className="w-4 h-4" />
              New Set
            </Link>
          </>
        }
      />

      {sets.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center border-2 border-dashed rounded-xl p-12">
          {q ? (
            <>
              <div className="bg-muted rounded-full p-4 mb-4">
                <Plus className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No sets match "{q}"</h3>
              <p className="text-muted-foreground mb-6 max-w-sm">
                Try adjusting your search terms or creating a new set.
              </p>
              <Link href="/sets/new" className={cn(buttonVariants())}>
                Create New Set
              </Link>
            </>
          ) : (
            <>
              <div className="bg-muted rounded-full p-4 mb-4">
                <Plus className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No sets yet</h3>
              <p className="text-muted-foreground mb-6 max-w-sm">
                Start building your knowledge by creating your first flashcard set.
              </p>
              <Link href="/sets/new" className={cn(buttonVariants())}>
                Create Your First Set
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {sets.map((set) => (
            <SetCard key={set.id} set={set} summary={summaries[set.id]} />
          ))}
        </div>
      )}
    </div>
  )
}
