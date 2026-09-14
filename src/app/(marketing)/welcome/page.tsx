import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Landing } from '@/components/home/Landing'

/**
 * The signed-out landing. Served at `/` by `src/middleware.ts`, which
 * REWRITES a request with no session to this page (the address bar keeps
 * `/`); a signed-in learner who arrives here directly is sent to `/`, their
 * home. The canonical URL is `/` so the two never compete in search.
 */
export const metadata: Metadata = { alternates: { canonical: '/' } }

export default async function WelcomePage() {
  const session = await auth()
  if (session?.user?.id) redirect('/')
  return <Landing />
}
