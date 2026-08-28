'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { Settings, GraduationCap, Bot, SlidersHorizontal, LifeBuoy, LogOut } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { handleSignOut } from '@/lib/actions/auth'

/**
 * The five destinations behind the avatar.
 *
 * Exported so a test can assert every one is reachable — a menu is the one
 * place where a route that exists but is linked from nowhere looks exactly like
 * a route that works.
 */
export const PROFILE_MENU_ITEMS = [
  { href: '/account', label: 'Settings', icon: Settings, hint: 'Handle, email, password, theme' },
  { href: '/profile', label: 'Learning', icon: GraduationCap, hint: 'What you know and what to study' },
  { href: '/settings/ai', label: 'AI settings', icon: Bot, hint: 'Provider keys and task routing' },
  { href: '/settings/study', label: 'Other settings', icon: SlidersHorizontal, hint: 'Grading and targeting' },
  { href: '/help', label: 'Help & feedback', icon: LifeBuoy, hint: 'Send us a message' },
] as const

/**
 * `avatar` and `menuAvatar` are the SAME mark at two sizes, rendered on the
 * server and passed in. The alternative — making this component resolve the
 * avatar itself — would drag `resolveAvatar` and the user row across the
 * server/client boundary for something that is a static image.
 *
 * `changePhoto` is a slot rather than a hardcoded button so the upload dialog
 * can be added without this file learning anything about blobs.
 */
export function ProfileMenu({
  avatar,
  menuAvatar,
  handle,
  name,
  changePhoto,
}: {
  avatar: ReactNode
  menuAvatar: ReactNode
  handle: string | null
  name: string | null
  changePhoto?: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Account menu"
        className="rounded-full transition-opacity hover:opacity-80
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                   focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {avatar}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-1.5">
        <div className="flex flex-col items-center gap-2 px-3 pt-4 pb-3">
          {menuAvatar}
          {changePhoto}
          <div className="text-center">
            {/* The handle is the public identity and leads; `name` comes from
                the OAuth provider and is usually a real full name, so it is
                secondary here and absent entirely when there is a handle. */}
            <p className="font-medium text-sm">{handle ? `@${handle}` : (name ?? 'Your account')}</p>
            {!handle && (
              <Link
                href="/account"
                onClick={() => setOpen(false)}
                className="text-xs text-muted-foreground underline underline-offset-4"
              >
                Set a handle
              </Link>
            )}
          </div>
        </div>

        <div className="h-px bg-border my-1" />

        <nav aria-label="Account">
          {PROFILE_MENU_ITEMS.map(({ href, label, icon: Icon, hint }) => (
            <Link
              key={href}
              href={href}
              title={hint}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground
                         transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="h-px bg-border my-1" />

        <form action={handleSignOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground
                       transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
