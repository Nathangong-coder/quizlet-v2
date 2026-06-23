import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SetForm } from '@/components/sets/SetForm'
import { h1 } from '@/lib/utils' // Wait, this is probably a mistake. I should just use HTML tags.

export default async function NewSetPage() {
  const session = await auth()

  if (!session) {
    redirect('/auth/signin')
  }

  return (
    <div className="container max-w-4xl py-10">
      <h1 className="text-3xl font-bold mb-8">Create New Study Set</h1>
      <SetForm mode="create" />
    </div>
  )
}
