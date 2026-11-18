import type { Metadata } from 'next'
import { DemoSetView } from '@/components/demo/DemoSetView'
import { DemoUnavailable } from '@/components/demo/DemoUnavailable'
import { readDemoConfig } from '@/lib/demo/config'
import { loadDemoSet } from '@/lib/demo/demo-set'

export const metadata: Metadata = { title: 'Demo — Flashcards' }
export const dynamic = 'force-dynamic'

export default async function DemoSetPage() {
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
      <h1 className="text-2xl font-semibold">{set.title}</h1>
      <DemoSetView cards={cards} />
    </div>
  )
}
