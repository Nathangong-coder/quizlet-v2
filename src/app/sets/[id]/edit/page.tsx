import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { SetForm } from '@/components/sets/SetForm'
import { notFound } from 'next/navigation'

interface EditSetPageProps {
  params: Promise<{ id: string }>
}

export default async function EditSetPage({ params }: EditSetPageProps) {
  const { id } = await params
  const session = await auth()

  if (!session) {
    redirect('/auth/signin')
  }

  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      categories: true,
      cards: {
        orderBy: { position: 'asc' },
        include: {
          contentBlocks: { orderBy: { position: 'asc' } },
          categoryAssignments: { include: { category: true } },
        },
      },
    },
  })

  if (!set) {
    notFound()
  }

  if (set.userId !== session.user.id) {
    redirect('/sets')
  }

  return (
    <div className="container max-w-4xl py-10">
      <h1 className="text-3xl font-bold mb-8">Edit Study Set</h1>
      <SetForm
        mode="edit"
        setId={set.id}
        initialTitle={set.title}
        initialDescription={set.description || ''}
        initialCategories={set.categories.map((c) => ({ name: c.name, color: c.color }))}
        initialCards={set.cards.map((c) => ({
          id: c.id,
          term: c.term,
          definition: c.definition,
          position: c.position,
          contentBlocks: c.contentBlocks,
          categoryNames: c.categoryAssignments.map((a) => a.category.name),
        }))}
      />
    </div>
  )
}
