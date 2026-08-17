import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { SetForm } from '@/components/sets/SetForm'
import { notFound } from 'next/navigation'
import VisibilityMenu from '@/components/sets/VisibilityMenu'
import { toSetVisibility } from '@/lib/sets/visibility'

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
      {/*
        Visibility sits at the top of Edit, beside the heading — it is a
        property of the set, not of the card list below, and it saves on its own
        the moment it changes. It used to occupy the block directly under the
        set's title on the set page, where it was read far more often than it
        was used.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <h1 className="text-3xl font-bold">Edit Study Set</h1>
        <VisibilityMenu setId={set.id} visibility={toSetVisibility(set.visibility)} />
      </div>
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
