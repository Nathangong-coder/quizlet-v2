'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, FileText, Folder, FolderPlus, Home, Library, LogIn, NotebookPen, Plus, Stethoscope } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isRailItemCurrent, isRecentCurrent, railItems, type RailIcon } from '@/lib/shell/nav'

const ICONS: Record<RailIcon, React.ComponentType<{ className?: string }>> = {
  home: Home,
  compass: Compass,
  library: Library,
  plus: Plus,
  login: LogIn,
}

export interface RailRecent {
  id: string
  title: string
  isOwn: boolean
}

export interface RailFolder {
  id: string
  name: string
}

/**
 * The rail's links. Text links intentionally share the compact text-sm/py-2
 * rhythm used by recent sets; section labels carry hierarchy instead of making
 * the primary destinations visually louder than the learner's own material.
 */
export function RailNav({
  signedIn,
  recents,
  folders,
  onNavigate,
  collapsed = false,
}: {
  signedIn: boolean
  recents: RailRecent[]
  folders: RailFolder[]
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const pathname = usePathname()
  const items = railItems(signedIn)
  const diagnosticCurrent = pathname === '/diagnostic' || pathname.startsWith('/diagnostic/')
  const postmortemCurrent = pathname === '/postmortem' || pathname.startsWith('/postmortem/')
  const notesCurrent = pathname === '/notes' || pathname.startsWith('/notes/')

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon]
        const current = isRailItemCurrent(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={current ? 'page' : undefined}
            aria-label={item.label}
            title={collapsed ? item.label : undefined}
            className={cn(
              'group flex items-center gap-2 rounded-[4px] py-1.5 text-sm transition-colors',
              collapsed ? 'justify-center px-0' : 'px-3',
              current
                ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--primary)]'
                : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && item.label}
          </Link>
        )
      })}

      {recents.length > 0 && (
        <>
          {!collapsed && <div className="mb-1.5 mt-6 px-3"><p className="label text-muted-foreground">Recents</p></div>}
          <ul className={cn('flex flex-col gap-0.5', collapsed && 'mt-6')}>
            {recents.map((recent) => {
              const current = isRecentCurrent(pathname, recent.id)
              return <li key={recent.id}><Link href={`/sets/${recent.id}`} onClick={onNavigate} aria-current={current ? 'page' : undefined} aria-label={recent.title} title={recent.title} className={cn('flex items-center gap-2 rounded-[4px] py-1.5 text-sm transition-colors', collapsed ? 'justify-center px-0' : 'px-3', current ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--primary)]' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground')}>{collapsed ? <Library className="h-4 w-4 shrink-0" aria-hidden="true" /> : <><span aria-hidden="true" className={cn('h-3.5 w-[3px] shrink-0 rounded-full', recent.isOwn ? 'bg-primary/50' : 'bg-muted-foreground/30')} /><span className="truncate">{recent.title}</span></>}</Link></li>
            })}
          </ul>
        </>
      )}

      {signedIn && <>
        <div className={cn('border-t border-sidebar-border pt-3', recents.length > 0 ? 'mt-4' : 'mt-6')}>
          <Link href="/folders" onClick={onNavigate} aria-label="All folders" title={collapsed ? 'All folders' : undefined} className={cn('mb-2 flex items-center gap-2 rounded-[4px] py-1.5 text-muted-foreground transition-colors hover:text-foreground', collapsed ? 'justify-center px-0' : 'px-3')}><Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{!collapsed && <span className="label">Your folders</span>}</Link>
          {folders.length > 0 && <ul className="flex flex-col gap-0.5">{folders.map((folder) => {
            const current = pathname === `/folders/${folder.id}`
            return <li key={folder.id}><Link href={`/folders/${folder.id}`} onClick={onNavigate} aria-current={current ? 'page' : undefined} aria-label={folder.name} title={collapsed ? folder.name : undefined} className={cn('flex items-center gap-2 rounded-[4px] py-1.5 text-sm transition-colors', collapsed ? 'justify-center px-0' : 'px-3', current ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--primary)]' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground')}><Folder className="h-4 w-4 shrink-0" aria-hidden="true" />{!collapsed && <span className="truncate">{folder.name}</span>}</Link></li>
          })}</ul>}
          <Link href="/folders/new" onClick={onNavigate} aria-label="Create a folder" title={collapsed ? '+ folder' : undefined} className={cn('flex items-center gap-2 rounded-[4px] py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-foreground', collapsed ? 'justify-center px-0' : 'px-3')}><FolderPlus className="h-4 w-4 shrink-0" aria-hidden="true" />{!collapsed && '+ folder'}</Link>
        </div>

        <div className="mt-4 border-t border-sidebar-border pt-3">
          {!collapsed && <p className="label mb-2 px-3 text-muted-foreground">Other features</p>}
          <RailFeatureLink href="/diagnostic" label="Diagnostic test" icon={Stethoscope} current={diagnosticCurrent} collapsed={collapsed} onNavigate={onNavigate} />
          <RailFeatureLink href="/postmortem" label="Postmortem" icon={NotebookPen} current={postmortemCurrent} collapsed={collapsed} onNavigate={onNavigate} />
          <RailFeatureLink href="/notes" label="Study notes" icon={FileText} current={notesCurrent} collapsed={collapsed} onNavigate={onNavigate} />
        </div>
      </>}
    </nav>
  )
}

function RailFeatureLink({ href, label, icon: Icon, current, collapsed, onNavigate }: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; current: boolean; collapsed: boolean; onNavigate?: () => void }) {
  return <Link href={href} onClick={onNavigate} aria-current={current ? 'page' : undefined} aria-label={label} title={collapsed ? label : undefined} className={cn('group flex items-center gap-2 rounded-[4px] py-1.5 text-sm transition-colors', collapsed ? 'justify-center px-0' : 'px-3', current ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--primary)]' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground')}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{!collapsed && label}</Link>
}
