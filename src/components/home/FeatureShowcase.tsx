'use client'

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FEATURES, type Feature } from '@/lib/marketing/features'
import { Mock } from '@/components/marketing/mocks'
import { StatusBadge } from '@/components/marketing/StatusBadge'

/**
 * The signed-out feature showcase: a tab per feature, each with its claim,
 * its lede, its hero mock, and a link to the full `/features/<slug>` page.
 *
 * The tabs are DERIVED from the marketing registry rather than declared here,
 * so the landing, the index and the feature pages cannot disagree about what
 * the app has. The copy rules — WHAT not HOW, nothing unbuilt as live, no
 * voice — live on the registry. `tests/components/landing.test.tsx` scans
 * this file for a database import, because the landing renders for every
 * anonymous hit.
 */

export interface ShowcaseTab {
  id: string
  label: string
  icon: Feature['icon']
  claim: string
  body: string
  feature: Feature
}

const TABS: ShowcaseTab[] = FEATURES.map((f) => ({
  id: f.slug,
  label: f.label,
  icon: f.icon,
  claim: f.claim,
  body: f.body,
  feature: f,
}))

export { TABS as SHOWCASE_TABS }

export function FeatureShowcase({ tabs = TABS }: { tabs?: ShowcaseTab[] }) {
  const [active, setActive] = useState(0)
  const baseId = useId()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Roving tabindex per the WAI-ARIA tabs pattern: arrows move focus AND
  // selection, Home/End jump. One tab stop in the list, not one per tab.
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const n = tabs.length
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % n
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next === null) return
    e.preventDefault()
    setActive(next)
    tabRefs.current[next]?.focus()
  }

  const current = tabs[active]

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
      <div role="tablist" aria-label="Ways to study" aria-orientation="vertical" className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {tabs.map((t, i) => {
          const selected = i === active
          const Icon = t.icon
          return (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[i] = el }}
              role="tab"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 rounded-full px-3.5 py-2 text-left text-sm font-medium transition-colors lg:rounded-lg lg:px-3',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden={true} />
              {t.label}
              {t.feature.status === 'coming' && (
                <span className={cn('ml-auto text-[10px] font-semibold uppercase tracking-wide', selected ? 'text-primary-foreground/80' : 'text-warning')}>
                  soon
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${current.id}`}
        aria-labelledby={`${baseId}-tab-${current.id}`}
        className="grid gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-start"
      >
        <div>
          <StatusBadge feature={current.feature} className="mb-3" />
          <h3 className="font-heading text-xl font-bold tracking-tight text-balance sm:text-2xl">{current.claim}</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{current.body}</p>
          <Link
            href={`/features/${current.id}`}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            Learn more
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div><Mock id={current.feature.heroMock} /></div>
      </div>
    </div>
  )
}
