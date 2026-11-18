import type { Metadata } from 'next'
import { DemoHome } from '@/components/demo/DemoHome'
import { DemoUnavailable } from '@/components/demo/DemoUnavailable'
import { readDemoConfig } from '@/lib/demo/config'
import { loadDemoSet } from '@/lib/demo/demo-set'

export const metadata: Metadata = { title: 'Demo' }
export const dynamic = 'force-dynamic'

export default async function DemoPage() {
  const set = readDemoConfig().enabled ? await loadDemoSet() : null
  if (!set) return <DemoUnavailable />
  return <DemoHome title={set.title} cardCount={set.cards.length} />
}
