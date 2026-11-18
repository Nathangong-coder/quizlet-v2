import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { DemoGauntlet } from '@/components/demo/DemoGauntlet'
import { DemoUnavailable } from '@/components/demo/DemoUnavailable'
import { readDemoConfig } from '@/lib/demo/config'
import { loadDemoSet } from '@/lib/demo/demo-set'

export const metadata: Metadata = { title: 'Demo — Gauntlet' }
export const dynamic = 'force-dynamic'

export default async function DemoGauntletPage() {
  const set = readDemoConfig().enabled ? await loadDemoSet() : null
  if (!set) return <DemoUnavailable />
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link href="/demo/games" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Games
      </Link>
      <div>
        <div className="label">Gauntlet</div>
        <h1 className="font-heading text-xl font-bold">{set.title}</h1>
      </div>
      <DemoGauntlet setId={set.id} />
    </div>
  )
}
