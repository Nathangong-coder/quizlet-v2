import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { previewInvite } from '@/actions/groups'
import { JoinGroupCard } from '@/components/groups/JoinGroupCard'

/**
 * `/groups/join/[code]` — the invite landing. Sign-in first (the callback
 * brings them back here), then the privacy contract, then the join. An
 * unknown or rotated code is a 404.
 */
export default async function JoinGroupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(`/groups/join/${code}`)}`)

  const preview = await previewInvite(code)
  if (!preview.success) notFound()

  return (
    <div className="mx-auto w-full max-w-2xl py-6">
      <JoinGroupCard code={code} group={preview.data} />
    </div>
  )
}
