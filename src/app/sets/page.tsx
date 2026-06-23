import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { SetCard } from '@/components/sets/SetCard'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { SearchBar } from '@/components/search/SearchBar'
import { Suspense } from 'react'

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
        <Button asChild>
          <Link href="/api/auth/signin">Sign In</Link>
        </Button>
      </div>
    )
  }

  const whereClause: any = {
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

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Sets</h1>
          <p className="text-muted-foreground">Manage your study materials and flashcard sets.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full md:w-auto">
          <Suspense fallback={<div className="h-10 w-full max-w-sm bg-muted animate-pulse rounded-md" />}>
            <SearchBar />
          </Suspense>
          <Button asChild>
            <Link href="/sets/new" className="flex items-center gap-2 whitespace-nowrap">
              <Plus className="w-4 h-4" />
              New Set
            </Link>
          </Button>
        </div>
      </div>

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
              <Button asChild>
                <Link href="/sets/new">Create New Set</Link>
              </Button>
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
              <Button asChild>
                <Link href="/sets/new">Create Your First Set</Link>
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {sets.map((set) => (
            <SetCard key={set.id} set={set} />
          ))}
        </div>
      )}
    </div>
  )
}
