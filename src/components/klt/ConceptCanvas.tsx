'use client'

import { useMemo, useRef, useState } from 'react'
import { Minus, Plus, Maximize2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { layoutTree, LAYOUT_DEFAULTS, type LayoutNode } from '@/lib/klt/layout'
import { evaluateDrop, type DragSource } from '@/lib/klt/drag'
import { iconFor, resolveNodeColor, NEUTRAL_NODE_COLOR } from '@/components/klt/node-style'
import type { ConceptTreeNode } from '@/actions/klt-tree'
import { SHADE_CLASS, SHADE_LABEL, type MasteryShade } from '@/lib/klt/mastery-shade'

const CANVAS_PADDING = 48
const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.6

interface ConceptCanvasProps {
  /**
   * Mastery shading, keyed on `normalizedName`. OPTIONAL, and absent is the
   * editor's case: `/sets/[id]/concepts` renders exactly as it always has.
   *
   * When present, the shade REPLACES the node's fill and border while the
   * user's chosen colour survives as the top accent bar. The two are answering
   * different questions and must not compete for the same surface: in the
   * editor the colour says "this is the branch I put it in", and on Knowledge
   * the fill says "this is how well you know it". Painting both into the fill
   * would make a well-known concept in a teal branch indistinguishable from a
   * badly-known one in a green branch.
   */
  shades?: Record<string, MasteryShade>
  /** Only what should be drawn — the caller applies collapse and filtering. */
  visible: ConceptTreeNode[]
  /** Every node in the set, for colour inheritance and drop arithmetic. */
  allNodes: ConceptTreeNode[]
  /** `kltId`s whose children are hidden. */
  collapsed: Set<string>
  selectedKltId: string | null
  /**
   * False for a read-only viewer: nodes stop being drag sources and stop
   * accepting drops, so there is no gesture that appears to work and then
   * fails at the server. Panning, zooming, collapsing and selecting all stay.
   */
  canEdit: boolean
  dragging: DragSource | null
  onSelect: (kltId: string | null) => void
  onToggleCollapse: (kltId: string) => void
  onDragStart: (source: DragSource) => void
  onDragEnd: () => void
  /** `null` target means the empty canvas: make the dragged concept a root. */
  onDrop: (targetKltId: string | null) => void
}

/**
 * The tree as a drawing: elbow connectors behind, node cards on top, dragging
 * to re-parent.
 *
 * Position comes entirely from `layoutTree`, never from stored coordinates.
 * That is the trade the design made explicit — you cannot park a node
 * wherever you like, and in exchange the tree can never be left in a tangled
 * state, and adding a concept re-tidies everything rather than dropping it on
 * top of something else.
 */
export function ConceptCanvas({
  shades,
  visible,
  allNodes,
  collapsed,
  selectedKltId,
  canEdit,
  dragging,
  onSelect,
  onToggleCollapse,
  onDragStart,
  onDragEnd,
  onDrop,
}: ConceptCanvasProps) {
  const [zoom, setZoom] = useState(1)
  const [hoverTarget, setHoverTarget] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  const layoutNodes: LayoutNode[] = useMemo(
    () => visible.map((n) => ({ kltId: n.kltId, parentKltId: n.parentKltId, name: n.name })),
    [visible],
  )
  const layout = useMemo(() => layoutTree(layoutNodes), [layoutNodes])

  const byKltId = useMemo(() => new Map(allNodes.map((n) => [n.kltId, n])), [allNodes])

  /**
   * Recomputed on every render while a drag is in flight, so the highlight and
   * the drop itself are decided by the same function — a target that lights up
   * green cannot then refuse on release.
   */
  const verdictFor = (targetKltId: string | null) =>
    canEdit && dragging ? evaluateDrop(dragging.kltId, targetKltId, allNodes) : null

  function beginPan(e: React.PointerEvent<HTMLDivElement>) {
    // Only the background pans. A pointerdown that lands on a node belongs to
    // that node's HTML5 drag, and stealing it here would make nodes undraggable.
    if ((e.target as HTMLElement).closest('[data-concept-node]')) return
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
    const el = scrollRef.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    panRef.current = null
  }

  function fitToWidth() {
    const el = scrollRef.current
    if (!el || layout.width === 0) return
    const available = el.clientWidth - CANVAS_PADDING * 2
    setZoom(Math.max(MIN_ZOOM, Math.min(1, available / layout.width)))
  }

  const scaledWidth = layout.width * zoom + CANVAS_PADDING * 2
  const scaledHeight = layout.height * zoom + CANVAS_PADDING * 2

  return (
    <div className="relative rounded-xl border bg-muted/20 overflow-hidden">
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-sm backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.15) * 100) / 100))}
        >
          <Minus className="size-4" />
        </Button>
        <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.15) * 100) / 100))}
        >
          <Plus className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Fit to width" onClick={fitToWidth}>
          <Maximize2 className="size-4" />
        </Button>
      </div>

      <div
        ref={scrollRef}
        data-testid="concept-canvas"
        className="relative h-[68vh] min-h-[420px] overflow-auto touch-none [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:22px_22px]"
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        // Dropping on the background means "make this a root". Every dragover
        // must preventDefault or the browser refuses the drop outright.
        onDragOver={(e) => {
          if ((e.target as HTMLElement).closest('[data-concept-node]')) return
          const verdict = verdictFor(null)
          if (verdict?.ok) {
            e.preventDefault()
            setHoverTarget('__root__')
          }
        }}
        onDragLeave={() => setHoverTarget(null)}
        onDrop={(e) => {
          if (!canEdit) return
          if ((e.target as HTMLElement).closest('[data-concept-node]')) return
          e.preventDefault()
          setHoverTarget(null)
          onDrop(null)
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-concept-node]')) return
          onSelect(null)
        }}
      >
        {hoverTarget === '__root__' && (
          <div className="pointer-events-none absolute inset-2 z-10 rounded-lg border-2 border-dashed border-primary/60" />
        )}

        <div
          style={{ width: scaledWidth, height: scaledHeight }}
          className="relative"
        >
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              width: layout.width,
              height: layout.height,
              marginLeft: CANVAS_PADDING,
              marginTop: CANVAS_PADDING,
            }}
            className="relative"
          >
            <svg
              data-testid="concept-edges"
              width={layout.width}
              height={layout.height}
              className="pointer-events-none absolute inset-0 overflow-visible"
              aria-hidden="true"
            >
              {layout.edges.map((edge) => {
                const child = byKltId.get(edge.childKltId)
                const stroke = child
                  ? resolveNodeColor(child, byKltId).stroke
                  : NEUTRAL_NODE_COLOR.stroke
                return (
                  <path
                    key={`${edge.parentKltId}->${edge.childKltId}`}
                    d={edge.path}
                    fill="none"
                    strokeWidth={2}
                    className={stroke}
                  />
                )
              })}
            </svg>

            {layout.nodes.map((pos) => {
              const node = byKltId.get(pos.kltId)
              if (!node) return null
              const colors = resolveNodeColor(node, byKltId)
              // Undefined when the caller passed no shades at all (the editor),
              // AND when this concept simply has no measurement. Both correctly
              // fall back to the structure colours; `shadeForKnowledge` is what
              // turns "measured, but no evidence" into an explicit `unknown`,
              // and that arrives here as a real shade rather than as a gap.
              const shade = shades?.[node.normalizedName]
              const Icon = iconFor(node.icon)
              const isSelected = node.kltId === selectedKltId
              const isDragged = dragging?.kltId === node.kltId
              const verdict = hoverTarget === node.kltId ? verdictFor(node.kltId) : null
              const isCollapsed = collapsed.has(node.kltId)

              return (
                <div
                  key={node.kltId}
                  data-concept-node={node.kltId}
                  data-depth={pos.depth}
                  style={{
                    position: 'absolute',
                    left: pos.x - LAYOUT_DEFAULTS.nodeWidth / 2,
                    top: pos.y,
                    width: LAYOUT_DEFAULTS.nodeWidth,
                    height: LAYOUT_DEFAULTS.nodeHeight,
                  }}
                >
                  <button
                    type="button"
                    draggable={canEdit}
                    aria-pressed={isSelected}
                    onClick={() => onSelect(node.kltId)}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      // Some browsers cancel a drag with no payload at all.
                      e.dataTransfer.setData('text/plain', node.name)
                      onDragStart({ kltId: node.kltId, name: node.name })
                    }}
                    onDragEnd={() => {
                      setHoverTarget(null)
                      onDragEnd()
                    }}
                    onDragOver={(e) => {
                      const v = verdictFor(node.kltId)
                      // Not preventing default on an illegal target is what
                      // makes the cursor show "no drop" — the refusal is the
                      // browser's, so it cannot disagree with ours.
                      if (v?.ok) e.preventDefault()
                      setHoverTarget(node.kltId)
                    }}
                    onDragLeave={() => setHoverTarget((t) => (t === node.kltId ? null : t))}
                    onDrop={(e) => {
                      if (!canEdit) return
                      e.preventDefault()
                      e.stopPropagation()
                      setHoverTarget(null)
                      onDrop(node.kltId)
                    }}
                    className={[
                      'relative flex h-full w-full flex-col justify-center gap-0.5 overflow-hidden rounded-lg border px-3 py-2 text-left transition',
                      canEdit ? 'cursor-grab' : 'cursor-pointer',
                      // Mastery takes the fill when it is supplied; the user's
                      // structure colour survives as the accent bar. Painting
                      // both into the fill would make a well-known concept in a
                      // teal branch indistinguishable from a badly-known one in
                      // a green branch.
                      shade ? SHADE_CLASS[shade] : `${colors.border} ${colors.fill}`,
                      isSelected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : '',
                      isDragged ? 'opacity-40' : '',
                      verdict?.ok ? 'ring-2 ring-primary' : '',
                      verdict && !verdict.ok ? 'ring-2 ring-destructive' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className={`absolute inset-x-0 top-0 h-1 ${colors.bar}`} aria-hidden="true" />
                    <span className="flex items-center gap-1.5">
                      <Icon className={`size-3.5 shrink-0 ${colors.text}`} aria-hidden="true" />
                      <span className="truncate text-sm font-medium">{node.name}</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {/* Named, not colour alone. A shade that only exists as a
                          fill is unreadable to anyone who cannot distinguish
                          the hues, and unguessable to everyone else. */}
                      {shade ? `${SHADE_LABEL[shade]} · ` : ''}
                      {node.linkCount} link{node.linkCount === 1 ? '' : 's'}
                      {node.childCount > 0 && ` · ${node.childCount} child${node.childCount === 1 ? '' : 'ren'}`}
                    </span>
                  </button>

                  {node.childCount > 0 && (
                    <button
                      type="button"
                      aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
                      onClick={() => onToggleCollapse(node.kltId)}
                      className="absolute -bottom-3 left-1/2 z-10 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm hover:text-foreground"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {layout.nodes.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Nothing to show here yet.
          </p>
        )}
      </div>
    </div>
  )
}
