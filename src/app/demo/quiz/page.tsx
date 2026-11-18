import type { Metadata } from 'next'
import { DemoQuiz } from '@/components/demo/DemoQuiz'
import { DemoUnavailable } from '@/components/demo/DemoUnavailable'
import { readDemoConfig } from '@/lib/demo/config'
import { loadDemoSet } from '@/lib/demo/demo-set'

export const metadata: Metadata = { title: 'Demo — Quiz' }
export const dynamic = 'force-dynamic'

export default async function DemoQuizPage() {
  const set = readDemoConfig().enabled ? await loadDemoSet() : null
  if (!set) return <DemoUnavailable />
  const cards = set.cards.map((c) => ({
    id: c.id,
    term: c.term,
    definition: c.definition,
    categories: c.categories,
    klps: c.klps.map((k) => ({ id: k.id, text: k.text })),
  }))
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Quiz</h1>
      <DemoQuiz cards={cards} />
    </div>
  )
}
