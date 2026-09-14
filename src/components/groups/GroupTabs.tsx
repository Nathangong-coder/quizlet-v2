'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface GroupTab {
  key: string
  label: string
  count?: number
}

/**
 * The group page's tab strip. Panels arrive from the server as rendered
 * nodes, so switching tabs is a state change with no fetch — the whole
 * group is one read. Keyboard: arrows move between tabs.
 */
export function GroupTabs({ tabs, panels, initial }: { tabs: GroupTab[]; panels: Record<string, ReactNode>; initial?: string }) {
  const [current, setCurrent] = useState(initial && tabs.some((t) => t.key === initial) ? initial : tabs[0]?.key)

  function onKey(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    setCurrent(next.key)
    ;(e.currentTarget.parentElement?.children[tabs.indexOf(next)] as HTMLButtonElement | undefined)?.focus()
  }

  return (
    <div>
      <div role="tablist" aria-label="Group" className="-mb-px flex gap-1 overflow-x-auto border-b border-border/80">
        {tabs.map((t, i) => {
          const on = t.key === current
          return (
            <button
              key={t.key}
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={on}
              aria-controls={`panel-${t.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setCurrent(t.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm transition-colors',
                on ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {t.label}
              {t.count !== undefined && <span className={cn('rounded-full px-1.5 text-[11px]', on ? 'bg-accent' : 'bg-muted')}>{t.count}</span>}
            </button>
          )
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`panel-${t.key}`} aria-labelledby={`tab-${t.key}`} hidden={t.key !== current} className="pt-6">
          {panels[t.key]}
        </div>
      ))}
    </div>
  )
}
