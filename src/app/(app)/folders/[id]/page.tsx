import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Folder } from 'lucide-react'
import { getFolder, getFolderOptions } from '@/actions/folders'
import { FolderWorkspace } from '@/components/folders/FolderWorkspace'
import { Button } from '@/components/ui/button'

export default async function FolderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [folderResult, optionsResult] = await Promise.all([getFolder(id), getFolderOptions()])
  if (!folderResult.success) notFound()
  if (!optionsResult.success) redirect('/login')
  const folder = folderResult.data

  return (
    <div className="w-full max-w-5xl space-y-8">
      <Button variant="ghost" size="sm" render={<Link href="/folders" />}><ArrowLeft className="h-4 w-4" aria-hidden="true" />All folders</Button>
      <header className="space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-primary"><Folder className="h-4 w-4" aria-hidden="true" />Your folder</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{folder.name}</h1><p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{folder.description || 'Keep the study material and lived experience around one goal in the same place.'}</p></header>
      <FolderWorkspace folder={folder} options={optionsResult.data} />
    </div>
  )
}
