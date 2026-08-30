import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SetForm } from '@/components/sets/SetForm'


export default async function NewSetPage() {
  const session = await auth()

  if (!session) {
    redirect('/login?callbackUrl=' + encodeURIComponent('/sets/new'))
  }

  return (
    <div className="w-full max-w-none">
      <h1 className="text-3xl font-bold mb-8">Create New Study Set</h1>
      <SetForm mode="create" />
    </div>
  )
}
