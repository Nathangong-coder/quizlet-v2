import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Folder, FolderPlus } from 'lucide-react'
import { listFolders } from '@/actions/folders'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default async function FoldersPage() {
  const result = await listFolders()
  if (!result.success) redirect('/login?callbackUrl=%2Ffolders')
  const folders = result.data

  return (
    <div className="w-full max-w-5xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Folder className="h-4 w-4" aria-hidden="true" />Your folders</div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Keep the whole thread together.</h1>
          <p className="text-base leading-relaxed text-muted-foreground">Gather the sets, notes, and offline evidence that belong to one interview, class, or season of work.</p>
        </div>
        <Button size="lg" render={<Link href="/folders/new" />}><FolderPlus className="h-4 w-4" aria-hidden="true" />New folder</Button>
      </header>

      {folders.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => (
            <Link key={folder.id} href={`/folders/${folder.id}`} className="group focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <Card className="h-full transition-[border-color,box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:shadow-[var(--shadow-md)]">
                <CardContent className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Folder className="h-5 w-5" aria-hidden="true" /></div><ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" /></div>
                  <h2 className="mt-5 truncate text-lg font-semibold group-hover:text-primary">{folder.name}</h2>
                  <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">{folder.description || 'A quiet place for the work around one goal.'}</p>
                  <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-6 text-xs text-muted-foreground"><span>{folder.counts.sets} sets</span><span>{folder.counts.notes} notes</span><span>{folder.counts.postmortems} postmortems</span></div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="border-dashed bg-muted/10"><CardContent className="flex flex-col items-center px-6 py-16 text-center"><div className="rounded-full bg-primary/10 p-3 text-primary"><Folder className="h-6 w-6" aria-hidden="true" /></div><h2 className="mt-4 text-lg font-semibold">Make a home for one thread</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Try “IB recruiting”, “Accounting midterm”, or any goal that needs more than one kind of study material.</p><Button className="mt-6" render={<Link href="/folders/new" />}><FolderPlus className="h-4 w-4" aria-hidden="true" />Create your first folder</Button></CardContent></Card>
      )}
    </div>
  )
}
