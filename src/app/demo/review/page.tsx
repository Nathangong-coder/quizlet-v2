import type { Metadata } from 'next'
import { DemoReview } from '@/components/demo/DemoReview'
import { DemoUnavailable } from '@/components/demo/DemoUnavailable'
import { readDemoConfig } from '@/lib/demo/config'
import { loadDemoSet } from '@/lib/demo/demo-set'

export const metadata: Metadata = { title: 'Demo — Review' }
export const dynamic = 'force-dynamic'

export default async function DemoReviewPage() {
  const set = readDemoConfig().enabled ? await loadDemoSet() : null
  if (!set) return <DemoUnavailable />
  const cards = set.cards.map((c) => ({ id: c.id, term: c.term, definition: c.definition }))
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Review</h1>
      <DemoReview cards={cards} />
    </div>
  )
}
