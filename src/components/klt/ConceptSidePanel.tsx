'use client'

import { GripVertical, Inbox } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { iconFor, resolveNodeColor } from '@/components/klt/node-style'
import type { DragSource } from '@/lib/klt/drag'
import type { ConceptTreeNode, UnplacedConcept } from '@/actions/klt-tree'

interface ConceptSidePanelProps {
  unplaced: UnplacedConcept[]
  nodes: ConceptTreeNode[]
  /** The canvas selection, which is what the Place button places under. */
  selected: ConceptTreeNode | null
  /**
   * False for a read-only viewer: rows stop being drag sources and the Place
   * buttons disappear. The lists themselves stay — knowing which concepts a
   * set uses, and which ones have no home yet, is a read.
   */
  canEdit: boolean
  filter: string
  onFilterChange: (value: string) => void
  onDragStart: (source: DragSource) => void
  onDragEnd: () => void
  onSelect: (kltId: string) => void
  onPlace: (concept: { kltId: string; name: string }) => void
  /** `kltId`s with a placement in flight. */
  placing: Set<string>
}

/**
 * The drag tray: concepts waiting for a home on top, then everything already
 * in the tree.
 *
 * Both sections are drag sources onto the canvas. Every drag also has a button
 * or click equivalent, because HTML5 drag-and-drop is unreachable by keyboard —
 * a canvas that can ONLY be edited by dragging is a canvas some people cannot
 * edit at all.
 */
export function ConceptSidePanel({
  unplaced,
  nodes,
  selected,
  canEdit,
  filter,
  onFilterChange,
  onDragStart,
  onDragEnd,
  onSelect,
  onPlace,
  placing,
}: ConceptSidePanelProps) {
  const q = filter.trim().toLowerCase()
  const matches = (name: string) => (q ? name.toLowerCase().includes(q) : true)

  const visibleUnplaced = unplaced.filter((u) => matches(u.name))
  const visibleNodes = [...nodes].filter((n) => matches(n.name)).sort((a, b) => a.name.localeCompare(b.name))
  const byKltId = new Map(nodes.map((n) => [n.kltId, n]))

  const dragProps = (source: DragSource) => ({
    draggable: canEdit,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', source.name)
      onDragStart(source)
    },
    onDragEnd,
  })

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4">
      <Input
        aria-label="Filter concepts"
        placeholder="Filter concepts…"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
      />

      <section className="rounded-xl border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Inbox className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">Unplaced</h3>
          <Badge variant="outline" className="ml-auto">
            {unplaced.length}
          </Badge>
        </header>

        {unplaced.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            Every concept your cards cite has a place in the tree.
          </p>
        ) : (
          <>
            <p className="px-3 pt-2 text-xs text-muted-foreground">
              {canEdit ? (
                <>
                  Drag one onto a node, or use the button to file it{' '}
                  {selected ? (
                    <>
                      under <strong>{selected.name}</strong>
                    </>
                  ) : (
                    'as a root'
                  )}
                  .
                </>
              ) : (
                'These concepts are used by this set’s cards but have no place in the tree yet.'
              )}
            </p>
            <ul className="max-h-64 overflow-auto p-2">
              {visibleUnplaced.map((u) => (
                <li
                  key={u.kltId}
                  {...dragProps({ kltId: u.kltId, name: u.name })}
                  className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent ${
                    canEdit ? 'cursor-grab' : ''
                  }`}
                >
                  {canEdit && (
                    <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{u.name}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {u.linkCount}
                  </Badge>
                  {canEdit && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-2 text-xs"
                      disabled={placing.has(u.kltId)}
                      onClick={() => onPlace({ kltId: u.kltId, name: u.name })}
                    >
                      {placing.has(u.kltId)
                        ? 'Placing…'
                        : selected
                          ? `Place under ${selected.name}`
                          : 'Place as root'}
                    </Button>
                  )}
                </li>
              ))}
              {visibleUnplaced.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">No match.</li>
              )}
            </ul>
          </>
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-xl border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <h3 className="text-sm font-medium">All concepts</h3>
          <Badge variant="outline" className="ml-auto">
            {nodes.length}
          </Badge>
        </header>
        <ul className="max-h-[40vh] overflow-auto p-2">
          {visibleNodes.map((n) => {
            const colors = resolveNodeColor(n, byKltId)
            const Icon = iconFor(n.icon)
            const parent = n.parentKltId ? byKltId.get(n.parentKltId) : null
            return (
              <li key={n.kltId}>
                <button
                  type="button"
                  {...dragProps({ kltId: n.kltId, name: n.name })}
                  onClick={() => onSelect(n.kltId)}
                  aria-pressed={selected?.kltId === n.kltId}
                  className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent ${
                    canEdit ? 'cursor-grab' : ''
                  } ${selected?.kltId === n.kltId ? 'bg-accent' : ''}`}
                >
                  <Icon className={`size-3.5 shrink-0 ${colors.text}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm">{n.name}</span>
                  <span className="shrink-0 truncate text-[10px] text-muted-foreground">
                    {parent ? parent.name : 'root'}
                  </span>
                </button>
              </li>
            )
          })}
          {visibleNodes.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              {nodes.length === 0 ? 'Nothing placed yet.' : 'No match.'}
            </li>
          )}
        </ul>
      </section>
    </aside>
  )
}
