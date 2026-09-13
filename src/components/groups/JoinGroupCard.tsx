'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Eye, EyeOff, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { joinGroup } from '@/actions/groups'

/**
 * The join screen. THE PRIVACY CONTRACT IS THE PAGE: what members will see,
 * what they will not, and that leaving ends it. The button stays disabled
 * until the checkbox is ticked, and `joinGroup` refuses without the flag, so
 * the consent cannot be skipped by a client that bypasses this component.
 */
export function JoinGroupCard({
  code,
  group,
}: {
  code: string
  group: { id: string; name: string; description: string | null; memberCount: number; setTitles: string[]; alreadyMember: boolean }
}) {
  const router = useRouter()
  const [acknowledged, setAcknowledged] = useState(false)
  const [isPending, startTransition] = useTransition()

  function join() {
    startTransition(async () => {
      const res = await joinGroup(code, acknowledged)
      if (!res.success) return void toast.error(res.error)
      toast.success(`You joined ${group.name}`)
      router.push(`/groups/${res.data.id}`)
      router.refresh()
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] sm:p-7">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Users className="h-4 w-4" aria-hidden="true" />
        You&rsquo;re invited
      </div>
      <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight">{group.name}</h1>
      {group.description && <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="metric">{group.memberCount}</span> {group.memberCount === 1 ? 'member' : 'members'}
        {group.setTitles.length > 0 && <> · studying {group.setTitles.join(', ')}</>}
      </p>

      {group.alreadyMember ? (
        <div className="mt-6">
          <p className="text-sm">You are already in this group.</p>
          <Button className="mt-3" render={<Link href={`/groups/${group.id}`} />}>Open it</Button>
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-lg border border-warning/40 bg-warning-subtle p-4 text-sm" role="note" aria-label="What this group will see">
            <p className="font-semibold">Before you join — what this group will see</p>
            <ul className="mt-3 space-y-2">
              <li className="flex gap-2.5">
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <span>
                  <span className="font-medium">Your progress on the group&rsquo;s sets</span>: how many cards you have studied and mastered, your average confidence, when you last studied, how long you have spent — and, card by card, whether you have it down. It appears on a leaderboard the other members can see.
                </span>
              </li>
              <li className="flex gap-2.5">
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                <span>
                  <span className="font-medium">Nothing else.</span> Not your other sets, not your written answers, not your memory history, not your email or name — members see your handle only.
                </span>
              </li>
              <li className="flex gap-2.5">
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                <span>
                  <span className="font-medium">Leaving stops it immediately.</span> Nothing is copied; the group reads your progress live, so once you leave there is nothing to delete.
                </span>
              </li>
            </ul>
          </div>

          <label className="mt-5 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>I understand that members of this group will see my progress on its sets.</span>
          </label>

          <div className="mt-5 flex gap-2">
            <Button type="button" onClick={join} disabled={!acknowledged || isPending}>
              {isPending ? 'Joining…' : 'Join group'}
            </Button>
            <Button type="button" variant="ghost" render={<Link href="/groups" />}>Not now</Button>
          </div>
        </>
      )}
    </div>
  )
}
