import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { SetCard } from '@/components/sets/SetCard'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Plus } from 'lucide-react'

export default async function SetsPage() {
  const session = await auth()

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

  const sets = await prisma.set.findMany({
    where: {
      userId: session.user.id,
    },
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
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Sets</h1>
          <p className="text-muted-foreground">Manage your study materials and flashcard sets.</p>
        </div>
        <Button asChild>
          <Link href="/sets/new" className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Set
          </Link>
        </Button>
      </div>

      {sets.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center border-2 border-dashed rounded-xl p-12">
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
