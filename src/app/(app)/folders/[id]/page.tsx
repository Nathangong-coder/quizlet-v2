import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Folder } from 'lucide-react'
import { getFolder, getFolderOptions } from '@/actions/folders'
import { CourseInfoButton } from '@/components/folders/CourseInfoButton'
import { FolderActions } from '@/components/folders/FolderActions'
import { FolderWorkspace } from '@/components/folders/FolderWorkspace'
import { Button } from '@/components/ui/button'

export default async function FolderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [folderResult, optionsResult] = await Promise.all([getFolder(id), getFolderOptions(id)])
  if (!folderResult.success) notFound()
  if (!optionsResult.success) redirect('/login')
  const folder = folderResult.data

  return (
    <div className="w-full space-y-8">
      <Button variant="ghost" size="sm" render={<Link href="/folders" />}><ArrowLeft className="h-4 w-4" aria-hidden="true" />All folders</Button>
      <header className="flex items-start justify-between gap-4 border-b border-border/70 pb-7"><div className="flex min-w-0 items-start gap-4"><div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-slate-900/70 dark:text-slate-300 sm:h-20 sm:w-20"><Folder className="h-8 w-8 sm:h-10 sm:w-10" aria-hidden="true" /></div><div className="min-w-0 space-y-3"><h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{folder.name}</h1><CourseInfoButton description={folder.description} tags={folder.tags} /></div></div><FolderActions id={folder.id} name={folder.name} description={folder.description} tags={folder.tags} pinned={folder.pinned} /></header>
      <FolderWorkspace folder={folder} options={optionsResult.data} />
    </div>
  )
}
