import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { FEATURES } from '@/lib/marketing/features'
import { StatusBadge } from '@/components/marketing/StatusBadge'

export const metadata: Metadata = { title: 'Features · synapseHQ' }

/**
 * `/features` — the index. One card per feature, in the registry's order.
 * Static, no data read.
 */
export default function FeaturesIndex() {
  return (
    <div className="py-8 sm:py-12">
      <h1 className="display">Seven ways to study one set</h1>
      <p className="lede mt-4">Every one of them feeds the same memory of what you know.</p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => {
          const Icon = f.icon
          return (
            <li key={f.slug}>
              <Link
                href={`/features/${f.slug}`}
                className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] transition-colors hover:border-primary/60"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Icon className="h-4 w-4" aria-hidden={true} />
                  {f.label}
                  <StatusBadge feature={f} />
                </div>
                <div className="mt-2 font-heading text-lg font-bold tracking-tight text-balance">{f.claim}</div>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">{f.body}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
