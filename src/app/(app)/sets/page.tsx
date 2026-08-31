import Link from 'next/link'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { BookOpen, ClipboardCheck, FileText, Folder, Layers, Plus } from 'lucide-react'
import { LibraryRow } from '@/components/library/LibraryRow'
import { LibraryToolbar, type LibrarySort } from '@/components/library/LibraryToolbar'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SignInButton } from '@/components/auth/SignInButton'
import { loadSetStudySummaries } from '@/lib/sets/study-summary'
import { AvatarMark } from '@/components/shell/AvatarMark'

const LIBRARY_TYPES = ['sets', 'folders', 'tests', 'guides'] as const
type LibraryType = (typeof LIBRARY_TYPES)[number]

const TYPE_LABELS: Record<LibraryType, string> = {
  sets: 'Flashcard sets',
  folders: 'Folders',
  tests: 'Practice tests',
  guides: 'Study guides',
}

function readType(value: string | undefined): LibraryType {
  return LIBRARY_TYPES.includes(value as LibraryType) ? value as LibraryType : 'sets'
}

function readSort(value: string | undefined): LibrarySort {
  return value === 'created' || value === 'studied' ? value : 'recent'
}

function byline(user: { id: string; name: string | null; handle: string | null }) {
  return user.handle ? `by ${user.handle}` : user.name ? `by ${user.name}` : 'by you'
}

function emptyMessage(type: LibraryType, query: string) {
  if (query) return `No ${TYPE_LABELS[type].toLowerCase()} match “${query}”.`
  return `You don't have any ${TYPE_LABELS[type].toLowerCase()} yet.`
}

export default async function SetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; sort?: string }>
}) {
  const session = await auth()
  const params = await searchParams
  const q = params.q?.trim() ?? ''
  const type = readType(params.type)
  const sort = readSort(params.sort)

  if (!session?.user?.id) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <h2 className="text-2xl font-bold">Sign in to see your sets</h2>
        <p className="text-muted-foreground">You need an account to manage your flashcard sets.</p>
        <SignInButton className={cn(buttonVariants())} />
      </div>
    )
  }

  const setWhere: Prisma.SetWhereInput = {
    userId: session.user.id,
  }

  if (q) {
    setWhere.OR = [
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

  const [user, sets, folders, practiceTests, studyGuides] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, handle: true, image: true, avatarUrl: true } }),
    prisma.set.findMany({ where: setWhere, orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }], take: 200, select: { id: true, title: true, description: true, createdAt: true, updatedAt: true, _count: { select: { cards: true } } } }),
    prisma.folder.findMany({ where: { userId: session.user.id, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}) }, orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }], take: 200, select: { id: true, name: true, description: true, createdAt: true, updatedAt: true, _count: { select: { sets: true, notes: true, postmortems: true, children: true } } } }),
    prisma.quizAttempt.findMany({ where: { userId: session.user.id, ...(q ? { OR: [{ mode: { contains: q, mode: 'insensitive' } }, { set: { title: { contains: q, mode: 'insensitive' } } }] } : {}) }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, setId: true, mode: true, score: true, questionCount: true, sessionId: true, createdAt: true, set: { select: { title: true } } } }),
    prisma.studyNote.findMany({ where: { userId: session.user.id, ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }] } : {}) }, orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }], take: 200, select: { id: true, title: true, body: true, createdAt: true, updatedAt: true } }),
  ])

  // One query for every set on the page rather than one per card. The list
  // could not previously answer "what should I open?" — it showed a title, a
  // card count and a creation date, none of which is study state.
  const summaries = await loadSetStudySummaries(prisma, session.user.id, sets.map((set) => set.id))
  const libraryUser = user ?? { id: session.user.id, name: session.user.name ?? null, handle: null, image: null, avatarUrl: null }
  const userForRow = { id: libraryUser.id, name: libraryUser.name, handle: libraryUser.handle, image: libraryUser.image, avatarUrl: libraryUser.avatarUrl }

  const sortedSets = [...sets].sort((a, b) => {
    const aTime = sort === 'studied' ? summaries[a.id]?.lastStudiedAt?.getTime() ?? 0 : sort === 'created' ? a.createdAt.getTime() : a.updatedAt.getTime()
    const bTime = sort === 'studied' ? summaries[b.id]?.lastStudiedAt?.getTime() ?? 0 : sort === 'created' ? b.createdAt.getTime() : b.updatedAt.getTime()
    return bTime - aTime || a.title.localeCompare(b.title)
  })
  const sortedFolders = [...folders].sort((a, b) => {
    const aTime = sort === 'created' ? a.createdAt.getTime() : a.updatedAt.getTime()
    const bTime = sort === 'created' ? b.createdAt.getTime() : b.updatedAt.getTime()
    return bTime - aTime || a.name.localeCompare(b.name)
  })
  const sortedTests = [...practiceTests].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const sortedGuides = [...studyGuides].sort((a, b) => {
    const aTime = sort === 'created' ? a.createdAt.getTime() : a.updatedAt.getTime()
    const bTime = sort === 'created' ? b.createdAt.getTime() : b.updatedAt.getTime()
    return bTime - aTime || a.title.localeCompare(b.title)
  })

  const activeRows = {
    sets: sortedSets.map((set) => ({ href: `/sets/${set.id}`, title: set.title, typeLabel: 'Flashcard set', meta: `${set._count.cards} ${set._count.cards === 1 ? 'term' : 'terms'}`, byline: byline(userForRow), icon: Layers, iconClass: 'text-sky-600 dark:text-sky-300', tileClass: 'bg-sky-50 dark:bg-sky-950/35', user: userForRow })),
    folders: sortedFolders.map((folder) => ({ href: `/folders/${folder.id}`, title: folder.name, typeLabel: 'Folder', meta: `${folder._count.sets + folder._count.notes + folder._count.postmortems + folder._count.children} items`, byline: byline(userForRow), icon: Folder, iconClass: 'text-slate-600 dark:text-slate-300', tileClass: 'bg-slate-100 dark:bg-slate-900/70', user: userForRow })),
    tests: sortedTests.map((test) => ({ href: test.sessionId ? `/profile/activity/${test.sessionId}` : `/sets/${test.setId}`, title: test.set.title, typeLabel: 'Practice test', meta: `${test.mode.replaceAll('-', ' ')} · ${test.score === null ? 'Not scored' : `${test.score}%`}${test.questionCount ? ` · ${test.questionCount} questions` : ''}`, byline: byline(userForRow), icon: ClipboardCheck, iconClass: 'text-emerald-600 dark:text-emerald-300', tileClass: 'bg-emerald-50 dark:bg-emerald-950/35', user: userForRow })),
    guides: sortedGuides.map((guide) => ({ href: `/notes/${guide.id}`, title: guide.title, typeLabel: 'Study guide', meta: `${guide.body.trim().split(/\s+/).filter(Boolean).length} words`, byline: byline(userForRow), icon: FileText, iconClass: 'text-fuchsia-600 dark:text-fuchsia-300', tileClass: 'bg-fuchsia-50 dark:bg-fuchsia-950/35', user: userForRow })),
  }[type]

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-6 border-b border-border/70 pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="hidden rounded-2xl bg-muted p-3 text-muted-foreground sm:block"><BookOpen className="h-7 w-7" aria-hidden="true" /></div>
          <div><p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your library</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">Everything in one place</h1><p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">Your sets, folders, practice, and study guides—ready when you are.</p></div>
        </div>
        <Link href="/sets/new" className={cn(buttonVariants(), 'flex items-center gap-2 self-start whitespace-nowrap lg:self-auto')}><Plus className="h-4 w-4" aria-hidden="true" />New set</Link>
      </header>

      <nav aria-label="Library content types" className="flex gap-2 overflow-x-auto border-b border-border/70 pb-px">
        {LIBRARY_TYPES.map((value) => <Link key={value} href={`/sets?type=${value}${sort !== 'recent' ? `&sort=${sort}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`} aria-current={type === value ? 'page' : undefined} className={cn('shrink-0 border-b-2 px-3 py-3 text-sm font-semibold transition-colors', type === value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground')}>{TYPE_LABELS[value]}</Link>)}
      </nav>

      <LibraryToolbar query={q} sort={sort} type={type} />

      {activeRows.length === 0 ? <div className="flex min-h-[32vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-16 text-center"><div className="rounded-full bg-muted p-3 text-muted-foreground"><Plus className="h-6 w-6" aria-hidden="true" /></div><h2 className="mt-4 text-xl font-semibold">{emptyMessage(type, q)}</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{type === 'sets' ? 'Start building your knowledge with a focused flashcard set.' : 'When you add something here, it will appear in this quiet library view.'}</p>{type === 'sets' && <Link href="/sets/new" className={cn(buttonVariants(), 'mt-6')}>Create a set</Link>}</div> : <ul className="border-t border-border/70">{activeRows.map((row) => <LibraryRow key={row.href} {...row} />)}</ul>}

      <div className="flex items-center gap-2 text-sm text-muted-foreground sm:hidden"><AvatarMark userId={userForRow.id} avatarUrl={userForRow.avatarUrl} image={userForRow.image} seed={userForRow.handle ?? userForRow.id} name={userForRow.name ?? userForRow.handle} size={24} />{byline(userForRow)}</div>
    </div>
  )
}
