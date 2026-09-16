import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Users } from 'lucide-react'
import { auth } from '@/auth'
import { Button } from '@/components/ui/button'
import { GroupForm } from '@/components/groups/GroupForm'

export default async function NewGroupPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Fgroups%2Fnew')

  return (
    <div className="w-full max-w-2xl space-y-8">
      <Button variant="ghost" size="sm" render={<Link href="/groups" />}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All groups
      </Button>
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Users className="h-4 w-4" aria-hidden="true" />
          New group
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create a study group</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          You get an invite link to send around. Members see each other&rsquo;s progress on the group&rsquo;s sets — and nothing else.
        </p>
      </header>
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] sm:p-7">
        <GroupForm />
      </div>
    </div>
  )
}
