'use client'

import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHADE_LABEL } from '@/lib/klt/mastery-shade'
import { MasteryBar } from '@/components/ui/mastery-bar'
import { ConceptKlps } from '@/components/sets/knowledge/ConceptKlps'
import type { TopicMasteryRow } from '@/lib/sets/knowledge'

/**
 * Concepts as a disclosure tree, weakest measured first within each level.
 *
 * THE ROWS ARE THE WHOLE FOREST — `selectConceptRows` returns every concept at
 * every depth, each carrying `parentKey`/`hasChildren`, and this component
 * renders that forest depth-first with client-side expansion state, roots
 * shown first and deeper rungs revealed on click. It used to have to pick ONE
 * rung (`selectConceptListDepth`) because a flat list has no way to show a
 * hierarchy; that function is gone, and so is the need to choose.
 *
 * It still takes `TopicMasteryRow[]` and imports nothing from KLT — no
 * `SetKltNode`, no `kltId`, no tree. The roadmap intends KLP-inherent topics
 * living beside user categories (CLAUDE.md, 2026-08-14), and when those land
 * they will produce rows of this shape from a different source and render here
 * unchanged. Typing this against the tree would have guaranteed a rewrite.
 *
 * Client component: it holds expansion state for both the child rows and the
 * per-concept key-point panel (`ConceptKlps`).
 */
export function MasteryList({ setId, rows }: { setId: string; rows: TopicMasteryRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [klpsOpen, setKlpsOpen] = useState<Set<string>>(new Set())

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, TopicMasteryRow[]>()
    for (const r of rows) {
      const list = map.get(r.parentKey)
      if (list) list.push(r)
      else map.set(r.parentKey, [r])
    }
    return map
  }, [rows])

  // Depth-first, roots first, honouring the order shapeTopicMastery produced
  // (weakest measured first) within each level.
  const visible = useMemo(() => {
    const out: { row: TopicMasteryRow; depth: number }[] = []
    const walk = (parent: string | null, depth: number) => {
      for (const row of childrenOf.get(parent) ?? []) {
        out.push({ row, depth })
        if (expanded.has(row.key)) walk(row.key, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [childrenOf, expanded])

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setter(next)
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8">
        No concept structure on this set yet. Build one, and the concepts your cards teach
        appear here with what you know about each.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className="label pb-2 font-normal text-muted-foreground">Concept</th>
            <th scope="col" className="label pb-2 font-normal text-muted-foreground w-1/2">Mastery</th>
            <th scope="col" className="label pb-2 font-normal text-muted-foreground text-right">Key points</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(({ row, depth }) => (
            <React.Fragment key={row.key}>
              <tr className="border-b last:border-0">
                <td className="py-2.5 pr-4 align-middle">
                  {/* The indent is REAL now. Rows are a forest, not one rung,
                      so depth is a claim the list can honestly make. */}
                  <span className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
                    {row.hasChildren ? (
                      <button
                        type="button"
                        onClick={() => toggle(expanded, row.key, setExpanded)}
                        aria-label={`${expanded.has(row.key) ? 'Collapse' : 'Expand'} ${row.name}`}
                        aria-expanded={expanded.has(row.key)}
                        className="rounded p-0.5 hover:bg-muted"
                      >
                        {expanded.has(row.key) ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-[1.375rem]" />
                    )}
                    {row.name}
                    <button
                      type="button"
                      onClick={() => toggle(klpsOpen, row.key, setKlpsOpen)}
                      aria-label={`Key points for ${row.name}`}
                      aria-expanded={klpsOpen.has(row.key)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Sparkles className="h-3 w-3" />
                    </button>
                  </span>
                </td>
                <td className="py-2.5 pr-4 align-middle">
                  <div className="flex items-center gap-3">
                    <MasteryBar knowledge={row.knowledge} shade={row.shade} className="max-w-[12rem]" />
                    {/*
                      The words, not the colour alone. A shade carried only by a
                      fill is unreadable to anyone who cannot distinguish the hues
                      — and for `unknown` the distinction that matters (no
                      evidence vs. bad evidence) is not expressible in a colour at
                      all.
                    */}
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        row.shade === 'unknown' ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {SHADE_LABEL[row.shade]}
                      {row.knowledge !== null && (
                        <span className="font-mono text-muted-foreground">
                          {' '}
                          {Math.round(row.knowledge * 100)}%
                        </span>
                      )}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                  {/*
                    MEASURED OF TOTAL, not the total alone. A concept can report
                    90% off three of its forty key points; the bar is deliberately
                    withheld in that case (see `MIN_MEASURED_FRACTION`) and this
                    column is where a learner sees WHY, instead of a colour that
                    vanished for no visible reason.
                  */}
                  {row.klpCount ? `${row.measuredKlpCount}/${row.klpCount}` : '—'}
                </td>
              </tr>
              {klpsOpen.has(row.key) && (
                <tr className="border-b last:border-0">
                  <td colSpan={3} className="bg-muted/30 px-4 py-2" style={{ paddingLeft: depth * 16 + 32 }}>
                    <ConceptKlps setId={setId} topicKey={row.key} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
