import Link from 'next/link'
import { ArrowLeft, FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FolderForm } from '@/components/folders/FolderForm'

export default function NewFolderPage() {
  return (
    <div className="w-full max-w-2xl space-y-8">
      <Button variant="ghost" size="sm" render={<Link href="/folders" />}><ArrowLeft className="h-4 w-4" aria-hidden="true" />All folders</Button>
      <header className="space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-primary"><FolderPlus className="h-4 w-4" aria-hidden="true" />New workspace</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create a folder</h1><p className="text-base leading-relaxed text-muted-foreground">A folder is a container for the context around one goal—not just another place to put sets.</p></header>
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] sm:p-7"><FolderForm /></div>
    </div>
  )
}
