'use client'

import { useMemo, useRef, useState } from 'react'
import { Minus, Plus, Crosshair } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { layoutDag, DAG_DEFAULTS } from '@/lib/klt/dag-layout'
import { iconFor, resolveNodeColor } from '@/components/klt/node-style'
import type { ConceptTreeNode, ConceptRelation } from '@/actions/klt-tree'

const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.6
const PADDING = 40

const EDGE_CLASS: Record<string, string> = {
  requires: 'stroke-amber-600 dark:stroke-amber-400',
  causes: 'stroke-rose-600 dark:stroke-rose-400',
  precedes: 'stroke-sky-600 dark:stroke-sky-400',
  applies_within: 'stroke-violet-600 dark:stroke-violet-400',
}
const EDGE_MARKER: Record<string, string> = {
  requires: 'dag-arrow-requires',
  causes: 'dag-arrow-causes',
  precedes: 'dag-arrow-precedes',
  applies_within: 'dag-arrow-applies',
}
const MARKER_FILL: Record<string, string> = {
  requires: 'fill-amber-600 dark:fill-amber-400',
  causes: 'fill-rose-600 dark:fill-rose-400',
  precedes: 'fill-sky-600 dark:fill-sky-400',
  applies_within: 'fill-violet-600 dark:fill-violet-400',
}

interface DagCanvasProps {
  /** Every placed node in the set — the DAG only draws the ones an edge touches. */
  allNodes: ConceptTreeNode[]
  relations: ConceptRelation[]
  selectedKltId: string | null
  onSelect: (kltId: string | null) => void
}

/**
 * The dependency view: the set's directed concept relations as a layered,
 * left-to-right drawing. A prerequisite always sits left of what needs it;
 * stroke width is the number of cards behind the edge. Selecting a node
 * focuses the drawing on its neighbourhood (the whole graph of a large set
 * is hundreds of nodes wide), and the same selection drives the inspector
 * the tree view uses, so renaming or merging from here is the same action.
 *
 * Nothing here writes: an edge is evidence the minting loop found, not
 * structure the owner edits. Placement, rollup and mastery are the tree's.
 */
export function DagCanvas({ allNodes, relations, selectedKltId, onSelect }: DagCanvasProps) {
  const [zoom, setZoom] = useState(0.85)
  const [minCards, setMinCards] = useState(1)
  const [includeRolled, setIncludeRolled] = useState(true)
  const [focus, setFocus] = useState(true)
  const [hops, setHops] = useState(2)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  const byKltId = useMemo(() => new Map(allNodes.map((n) => [n.kltId, n])), [allNodes])
  const layout = useMemo(
    () =>
      layoutDag(
        allNodes.map((n) => ({ kltId: n.kltId, name: n.name })),
        relations,
        {
          minCards,
          provenances: includeRolled ? undefined : new Set(['minted', 'manual', 'reconciled']),
          focusKltId: focus ? selectedKltId : null,
          hops,
        },
      ),
    [allNodes, relations, minCards, includeRolled, focus, selectedKltId, hops],
  )

  function beginPan(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-dag-node]')) return
    const el = scrollRef.current
    if (!el) return
    panRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }
  function movePan(e: React.PointerEvent<HTMLDivElement>) {
    const start = panRef.current
    const el = scrollRef.current
    if (!start || !el) return
    el.scrollLeft = start.left - (e.clientX - start.x)
    el.scrollTop = start.top - (e.clientY - start.y)
  }
  function endPan(e: React.PointerEvent<HTMLDivElement>) {
    panRef.current = null
    scrollRef.current?.releasePointerCapture(e.pointerId)
  }

  const maxCards = Math.max(1, ...relations.map((r) => r.cardCount))
  const strokeFor = (cards: number) => 1 + Math.min(4, (cards - 1) * 0.9)
  const focused = focus && selectedKltId ? byKltId.get(selectedKltId) ?? null : null

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5 text-xs">
        <Button type="button" variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.15) * 100) / 100))}>
          <Minus className="size-4" />
        </Button>
        <span className="w-10 text-center tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <Button type="button" variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.15) * 100) / 100))}>
          <Plus className="size-4" />
        </Button>
        <label className="ml-2 flex items-center gap-1.5">
          <span className="text-muted-foreground">min cards</span>
          <input type="range" min={1} max={Math.max(2, maxCards)} value={minCards} onChange={(e) => setMinCards(Number(e.target.value))} className="w-20" aria-label="Minimum cards behind an edge" />
          <span className="w-4 tabular-nums">{minCards}</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={includeRolled} onChange={(e) => setIncludeRolled(e.target.checked)} />
          <span className="text-muted-foreground" title="An edge whose endpoint was placed under a general node is also counted one level up">rolled-up edges</span>
        </label>
        <Button type="button" variant={focus ? 'secondary' : 'ghost'} size="sm" aria-pressed={focus} title="Show only the selected concept's neighbourhood" onClick={() => setFocus((v) => !v)}>
          <Crosshair className="mr-1 size-4" />
          focus
        </Button>
        {focus && (
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">hops</span>
            <input type="range" min={1} max={4} value={hops} onChange={(e) => setHops(Number(e.target.value))} className="w-16" aria-label="Neighbourhood radius" />
            <span className="w-3 tabular-nums">{hops}</span>
          </label>
        )}
        <span className="ml-auto text-muted-foreground">
          {focused ? <>around <strong className="text-foreground">{focused.name}</strong> · </> : focus ? 'select a concept to focus · ' : ''}
          {layout.nodes.length} concept{layout.nodes.length === 1 ? '' : 's'}, {layout.kept} of {layout.total} edges, {layout.layers} layer{layout.layers === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 border-b px-3 py-1 text-[11px] text-muted-foreground">
        {Object.entries(EDGE_CLASS).map(([type, cls]) => (
          <span key={type} className="flex items-center gap-1">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" strokeWidth="2" className={cls} /></svg>
            {type.replace('_', ' ')}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" strokeWidth="2" strokeDasharray="4 3" className="stroke-muted-foreground" /></svg>
          closes a cycle
        </span>
        <span>thicker = more cards</span>
      </div>

      <div
        ref={scrollRef}
        data-testid="dag-canvas"
        className="relative h-[68vh] min-h-[420px] overflow-auto touch-none [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:22px_22px]"
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('[data-dag-node]')) onSelect(null)
        }}
      >
        {layout.nodes.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {relations.length === 0 ? 'No directed relations in this set yet — run the minting loop and the tree rebuild.' : 'Nothing passes the filter. Lower the minimum cards, widen the hops, or turn focus off.'}
          </p>
        ) : (
          <div style={{ width: (layout.width + PADDING * 2) * zoom, height: (layout.height + PADDING * 2) * zoom }}>
            <div className="relative origin-top-left" style={{ width: layout.width + PADDING * 2, height: layout.height + PADDING * 2, transform: `scale(${zoom})` }}>
              <svg className="absolute inset-0" width={layout.width + PADDING * 2} height={layout.height + PADDING * 2} aria-hidden="true">
                <defs>
                  {Object.entries(EDGE_MARKER).map(([type, id]) => (
                    <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" className={MARKER_FILL[type]} />
                    </marker>
                  ))}
                </defs>
                <g transform={`translate(${PADDING} ${PADDING})`}>
                  {layout.edges.map((ed) => {
                    const cls = EDGE_CLASS[ed.type] ?? 'stroke-muted-foreground'
                    const touchesSelected = selectedKltId !== null && (ed.fromKltId === selectedKltId || ed.toKltId === selectedKltId)
                    return (
                      <g key={`${ed.fromKltId}-${ed.type}-${ed.toKltId}`} className="group">
                        <path
                          d={ed.path}
                          fill="none"
                          strokeWidth={strokeFor(ed.cardCount)}
                          strokeDasharray={ed.backEdge ? '5 4' : undefined}
                          markerEnd={`url(#${EDGE_MARKER[ed.type] ?? 'dag-arrow-requires'})`}
                          className={`${cls} ${touchesSelected ? 'opacity-100' : selectedKltId ? 'opacity-30' : 'opacity-75'}`}
                        />
                        <path d={ed.path} fill="none" strokeWidth={12} className="stroke-transparent">
                          <title>{`${byKltId.get(ed.fromKltId)?.name ?? ''} ${ed.type.replace('_', ' ')} ${byKltId.get(ed.toKltId)?.name ?? ''} · ${ed.cardCount} card${ed.cardCount === 1 ? '' : 's'} · ${ed.provenance}`}</title>
                        </path>
                        <text x={ed.midX} y={ed.midY - 4} textAnchor="middle" className="fill-muted-foreground text-[10px] opacity-0 group-hover:opacity-100">
                          {ed.type.replace('_', ' ')} · {ed.cardCount}
                        </text>
                      </g>
                    )
                  })}
                </g>
              </svg>

              {layout.nodes.map((nd) => {
                const node = byKltId.get(nd.kltId)
                if (!node) return null
                const colors = resolveNodeColor(node, byKltId)
                const Icon = iconFor(node.icon)
                const isSelected = nd.kltId === selectedKltId
                return (
                  <button
                    key={nd.kltId}
                    type="button"
                    data-dag-node
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(isSelected ? null : nd.kltId)
                    }}
                    aria-pressed={isSelected}
                    title={`${node.name} · ${nd.inDegree} in, ${nd.outDegree} out · ${node.linkCount} link${node.linkCount === 1 ? '' : 's'}`}
                    style={{ left: nd.x + PADDING, top: nd.y + PADDING, width: DAG_DEFAULTS.nodeWidth, height: DAG_DEFAULTS.nodeHeight }}
                    className={`absolute flex items-center gap-1.5 rounded-lg border px-2 text-left text-xs shadow-sm transition-shadow ${colors.fill} ${colors.border} ${
                      isSelected ? 'ring-2 ring-primary' : 'hover:shadow-md'
                    }`}
                  >
                    <Icon className={`size-3.5 shrink-0 ${colors.text}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
                    <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{nd.inDegree}→{nd.outDegree}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
