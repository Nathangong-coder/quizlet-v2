import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { AvatarMark } from '@/components/shell/AvatarMark'

export interface LibraryRowProps {
  href: string
  title: string
  typeLabel: string
  meta: string
  byline: string
  icon: LucideIcon
  iconClass: string
  tileClass: string
  user?: {
    id: string
    name?: string | null
    handle?: string | null
    image?: string | null
    avatarUrl?: string | null
  }
}

export function LibraryRow({ href, title, typeLabel, meta, byline, icon: Icon, iconClass, tileClass, user }: LibraryRowProps) {
  return (
    <li>
      <Link href={href} className="group flex min-w-0 items-center gap-3 border-b border-border/70 px-1 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-5 sm:py-5">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tileClass} ${iconClass}`}>
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold tracking-tight transition-colors group-hover:text-primary sm:text-lg">{title}</span>
          <span className="mt-1 block truncate text-sm text-muted-foreground">{typeLabel} · {meta}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-2 text-right sm:flex">
          {user && <AvatarMark userId={user.id} avatarUrl={user.avatarUrl} image={user.image} seed={user.handle ?? user.id} name={user.name ?? user.handle} size={32} />}
          <span className="max-w-32 truncate text-sm text-muted-foreground">{byline}</span>
        </span>
        <span className="shrink-0 text-sm text-muted-foreground sm:hidden">{byline}</span>
      </Link>
    </li>
  )
}
