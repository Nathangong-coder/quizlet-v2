'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Map as MapIcon, List as ListIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConceptCanvas } from '@/components/klt/ConceptCanvas'
import { MasteryList } from '@/components/sets/knowledge/MasteryList'
import { listConceptTree, type ConceptTreeNode } from '@/actions/klt-tree'
import type { MasteryShade } from '@/lib/klt/mastery-shade'
import type { TopicMasteryRow } from '@/lib/sets/knowledge'
import type { ConceptView } from '@/lib/sets/views'

/**
 * The concept surface on Knowledge: the map, or the list.
 *
 * READ-ONLY BY CONSTRUCTION — `canEdit={false}`, `dragging={null}` and no-op
 * drag handlers. The canvas already supports that mode properly (panning,
 * zooming, collapsing and selecting all survive; nodes stop being drag sources),
 * so a reader gets no gesture that appears to work and then fails at the server.
 * Structure is still authored at `/sets/[id]/concepts`, which is unchanged.
 *
 * THE LIST IS NOT A FALLBACK, AND IT IS THE SAME AXIS AS THE MAP. Both draw
 * `Klt` concepts; the list shows one rung of the tree (`selectConceptListDepth`)
 * because a list has to pick a level, while the map draws every node at once.
 * Until 2026-08-28 the list rendered the user-authored CATEGORY axis instead,
 * so toggling the view silently changed what a "concept" was — and the map's
 * shades, keyed by name off that same category axis, coloured a tree node
 * whenever its name happened to collide with a category. Categories now have
 * their own block, below this one on the page.
 *
 * The list still takes `TopicMasteryRow[]` and imports nothing from KLT,
 * because it has to outlive the concept tree: the roadmap intends KLP-inherent
 * topics living beside user categories, and when those arrive they produce rows
 * of exactly this shape. The map is the half that is tied to `SetKltNode`.
 */
export function ConceptMastery({
  setId,
  rows,
  shades,
  initialView,
  canEdit,
}: {
  setId: string
  rows: TopicMasteryRow[]
  shades: Record<string, MasteryShade>
  initialView: ConceptView
  canEdit: boolean
}) {
  const [view, setView] = useState<ConceptView>(initialView)
  const [nodes, setNodes] = useState<ConceptTreeNode[] | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // Only fetched for the map, and only once. The list already has everything it
  // needs from the server, so choosing it must not pay for a tree query.
  useEffect(() => {
    if (view !== 'map' || nodes !== null || failed) return
    let live = true
    listConceptTree(setId).then((result) => {
      if (!live) return
      if (result.success) setNodes(result.data.nodes)
      else setFailed(true)
    })
    return () => {
      live = false
    }
  }, [view, nodes, failed, setId])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div
          role="group"
          aria-label="Concept view"
          className="inline-flex rounded-md border p-0.5"
        >
          {(
            [
              { key: 'map' as const, label: 'Map', Icon: MapIcon },
              { key: 'list' as const, label: 'List', Icon: ListIcon },
            ]
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setView(key)
                // The choice is a URL param so it survives a reload and can be
                // linked. `replaceState` rather than a router push: this is a
                // display preference, and putting it in the history stack makes
                // Back undo a toggle instead of leaving the page.
                const url = new URL(window.location.href)
                if (key === 'map') url.searchParams.delete('view')
                else url.searchParams.set('view', key)
                window.history.replaceState(null, '', url)
              }}
              aria-pressed={view === key}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition-colors',
                view === key
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {canEdit && (
          <Link
            href={`/sets/${setId}/concepts`}
            className="text-sm underline underline-offset-4 text-muted-foreground hover:text-foreground"
          >
            Edit structure
          </Link>
        )}
      </div>

      {view === 'list' ? (
        <MasteryList rows={rows} />
      ) : failed ? (
        <p className="text-sm text-muted-foreground py-8">
          The concept map could not be loaded.{' '}
          <button type="button" onClick={() => setView('list')} className="underline underline-offset-4">
            Show the list instead
          </button>
          .
        </p>
      ) : nodes === null ? (
        <div className="h-[420px] rounded-xl border bg-muted/20 animate-pulse" />
      ) : nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8">
          This set has no concept structure yet.{' '}
          {canEdit ? (
            <Link href={`/sets/${setId}/concepts`} className="underline underline-offset-4">
              Build one
            </Link>
          ) : (
            'Its owner has not built one.'
          )}
          {/* The list is NOT offered as an alternative here any more. It reads
              the same concept tree this message is reporting the absence of, so
              pointing at it would send the reader to a second empty view. Their
              own categories are still measured, in their own block below. */}
        </p>
      ) : (
        <ConceptCanvas
          shades={shades}
          visible={nodes.filter(
            (n) => !n.ancestorIds.some((ancestorId) => collapsed.has(ancestorId)),
          )}
          allNodes={nodes}
          collapsed={collapsed}
          selectedKltId={selected}
          canEdit={false}
          dragging={null}
          onSelect={setSelected}
          onToggleCollapse={(kltId) =>
            setCollapsed((prev) => {
              const next = new Set(prev)
              if (next.has(kltId)) next.delete(kltId)
              else next.add(kltId)
              return next
            })
          }
          onDragStart={() => {}}
          onDragEnd={() => {}}
          onDrop={() => {}}
        />
      )}
    </div>
  )
}
