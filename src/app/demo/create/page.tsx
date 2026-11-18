import type { Metadata } from 'next'
import { DemoUnavailable } from '@/components/demo/DemoUnavailable'
import { GuestCardBuilder } from '@/components/demo/GuestCardBuilder'
import { readDemoConfig } from '@/lib/demo/config'
import { loadDemoSet } from '@/lib/demo/demo-set'

export const metadata: Metadata = { title: 'Demo — Make a card' }
export const dynamic = 'force-dynamic'

export default async function DemoCreatePage() {
  const set = readDemoConfig().enabled ? await loadDemoSet() : null
  if (!set) return <DemoUnavailable />
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Make a card</h1>
      <GuestCardBuilder />
    </div>
  )
}
