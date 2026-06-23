import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { DeleteSetButton } from '@/components/sets/DeleteSetButton'
import { ArrowLeft, Edit, Play } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

export default async function SetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()

  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      cards: {
        orderBy: { position: 'asc' },
      },
    },
  })

  if (!set) {
    notFound()
  }

  const isOwner = session?.user?.id === set.userId

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/sets" className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Sets
          </Link>
        </Button>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">{set.title}</h1>
          {set.description && (
            <p className="text-lg text-muted-foreground max-w-2xl">
              {set.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/sets/${id}/match`} className="flex items-center gap-2">
              <Play className="w-4 h-4" />
              Matching Game
            </Link>
          </Button>
          {isOwner && (
            <>
              <Button variant="outline" asChild>
                <Link href={`/sets/${id}/edit`} className="flex items-center gap-2">
                  <Edit className="w-4 h-4" />
                  Edit Set
                </Link>
              </Button>
              <DeleteSetButton setId={id} />
            </>
          )}
        </div>
      </div>

      <Separator className="mb-8" />

      <div className="space-y-4">
        <h2 className="text-2xl font-semibold mb-4">Cards ({set.cards.length})</h2>
        <div className="grid gap-4">
          {set.cards.map((card, index) => (
            <div
              key={card.id}
              className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex gap-4">
                <span className="text-muted-foreground font-mono text-sm pt-1">
                  {index + 1}.
                </span>
                <div className="font-medium">
                  {card.term}
                </div>
              </div>
              <div className="text-muted-foreground md:pl-8">
                {card.definition}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
