'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, ClipboardCheck, Compass, Folder, Gamepad2, Gauge, Home, Layers, Library, LogIn, Plus, ScrollText, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isRailItemCurrent, railSections, type RailIcon } from '@/lib/shell/nav'

const ICONS: Record<RailIcon, React.ComponentType<{ className?: string }>> = {
  home: Home,
  bell: Bell,
  library: Library,
  compass: Compass,
  layers: Layers,
  scroll: ScrollText,
  gamepad: Gamepad2,
  clipboard: ClipboardCheck,
  plus: Plus,
  login: LogIn,
  gauge: Gauge,
  users: Users,
}

export interface RailFolder {
  id: string
  name: string
}

export interface RailGroup {
  id: string
  name: string
}

const ROW = 'group flex items-center gap-2 rounded-[4px] py-1.5 text-sm transition-colors'
const CURRENT = 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--primary)]'
const IDLE = 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground'

/**
 * The rail's links: the sections from `railSections`, then the learner's
 * folders and groups as plain name lists with a "+ folder" / "+ group" row
 * (no section titles — the names are the title). Notifications carry the
 * unread count as a badge.
 */
export function RailNav({
  signedIn,
  role,
  folders,
  groups = [],
  unread = 0,
  onNavigate,
  collapsed = false,
}: {
  signedIn: boolean
  role?: string | null
  folders: RailFolder[]
  groups?: RailGroup[]
  unread?: number
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const pathname = usePathname()
  const sections = railSections(signedIn, role)

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {sections.map((section, si) => (
        <div key={si} className={cn(si > 0 && 'mt-5')}>
          {section.label && !collapsed && <p className="label mb-1.5 px-3 text-muted-foreground">{section.label}</p>}
          {section.items.map((item) => {
            const Icon = ICONS[item.icon]
            const current = isRailItemCurrent(pathname, item.href)
            const badge = item.icon === 'bell' && unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={current ? 'page' : undefined}
                aria-label={badge ? `${item.label}, ${unread} unread` : item.label}
                title={collapsed ? item.label : undefined}
                className={cn(ROW, collapsed ? 'relative justify-center px-0' : 'px-3', current ? CURRENT : IDLE)}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                {badge && (
                  <span className={cn('rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground', collapsed && 'absolute -right-0.5 -top-0.5')} data-testid="unread-badge">
                    {badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}

      {signedIn && (
        <>
          <NameList
            items={folders}
            icon={Folder}
            hrefFor={(id) => `/folders/${id}`}
            addHref="/folders/new"
            addLabel="+ folder"
            allHref="/folders"
            allLabel="All folders"
            pathname={pathname}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
          <NameList
            items={groups}
            icon={Users}
            hrefFor={(id) => `/groups/${id}`}
            addHref="/groups/new"
            addLabel="+ group"
            allHref="/groups"
            allLabel="All groups"
            pathname={pathname}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        </>
      )}
    </nav>
  )
}

/**
 * A list of the learner's own things by name, then a plain "+ …" row. No
 * title (the owner's call): the names say what the list is. Collapsed, the
 * rows become icons and the "+" row becomes a plus.
 */
function NameList({
  items,
  icon: Icon,
  hrefFor,
  addHref,
  addLabel,
  allHref,
  allLabel,
  pathname,
  collapsed,
  onNavigate,
}: {
  items: { id: string; name: string }[]
  icon: React.ComponentType<{ className?: string }>
  hrefFor: (id: string) => string
  addHref: string
  addLabel: string
  allHref: string
  allLabel: string
  pathname: string
  collapsed: boolean
  onNavigate?: () => void
}) {
  return (
    <div className="mt-5 border-t border-sidebar-border pt-3">
      {items.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const href = hrefFor(item.id)
            const current = pathname === href
            return (
              <li key={item.id}>
                <Link href={href} onClick={onNavigate} aria-current={current ? 'page' : undefined} aria-label={item.name} title={collapsed ? item.name : undefined} className={cn(ROW, collapsed ? 'justify-center px-0' : 'px-3', current ? CURRENT : IDLE)}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {!collapsed && <span className="truncate">{item.name}</span>}
                </Link>
              </li>
            )
          })}
          {items.length >= 6 && !collapsed && (
            <li><Link href={allHref} onClick={onNavigate} className={cn(ROW, 'px-3 text-xs', IDLE)}>{allLabel} →</Link></li>
          )}
        </ul>
      )}
      <Link href={addHref} onClick={onNavigate} aria-label={addLabel} title={collapsed ? addLabel : undefined} className={cn(ROW, collapsed ? 'justify-center px-0' : 'px-3', IDLE)}>
        {collapsed ? <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> : addLabel}
      </Link>
    </div>
  )
}
