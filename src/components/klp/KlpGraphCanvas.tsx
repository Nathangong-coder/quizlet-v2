'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  layoutKlpGraph,
  edgeGeometry,
  applyOverrides,
  graphExtent,
  clampScale,
  fitScale,
  RELATION_STYLE,
  NODE_WIDTH,
  NODE_HEIGHT,
  type PositionOverrides,
} from '@/lib/klp/graph-layout'
import { VERDICT_CREDIT, isKlpVerdict } from '@/lib/klp/verdicts'
import type { KlpNode, KlpEdge } from '@/components/klp/KlpCardPanel'

/**
 * One learner's outcome on this card, for the answer overlay.
 *
 * `statuses` is keyed by NODE INDEX, not by KLP id, because everything the
 * graph draws is addressed by position — the same reason `loadCardKlpGraphs`
 * converts relation endpoints to indexes in one place.
 */
export interface AnswerOverlay {
  /** What to call this view in the toggle: "Your answer", a learner's name. */
  label: string
  /** Node index -> AnswerKlpResult.status. A missing entry means NOT TESTED. */
  statuses: Record<number, string>
}

export interface KlpGraphCanvasProps {
  klps: KlpNode[]
  relations: KlpEdge[]
  answer?: AnswerOverlay | null
  activeIndex: number | null
  onActiveChange: (index: number | null) => void
  hoveredEdgeId: string | null
  onHoveredEdgeChange: (id: string | null) => void
  selectedEdgeId: string | null
  onSelectedEdgeChange: (id: string | null) => void
  kLabel: (index: number) => string
  rLabel: (index: number) => string
}

type Outcome = 'right' | 'partial' | 'wrong' | 'untested'

/**
 * A status becomes a colour through `VERDICT_CREDIT`, never through its own
 * name.
 *
 * The status vocabulary is thirteen labels today and was three before — and
 * they are not ordered, so `inversion` is not "more wrong" than `omission`, it
 * is differently wrong. Credit is the one axis that IS ordered, so it is what
 * a colour can honestly encode. Reading the label directly would mean this
 * component needing an update every time the vocabulary widens.
 */
export function outcomeOf(status: string | undefined): Outcome {
  if (status === undefined) return 'untested'
  if (!isKlpVerdict(status)) return 'untested'
  const credit = VERDICT_CREDIT[status]
  if (credit >= 1) return 'right'
  if (credit > 0) return 'partial'
  return 'wrong'
}

const NODE_FILL: Record<Outcome, string> = {
  right: 'fill-emerald-500/15 stroke-emerald-600 dark:stroke-emerald-400',
  partial: 'fill-amber-500/15 stroke-amber-600 dark:stroke-amber-400',
  wrong: 'fill-red-500/15 stroke-red-600 dark:stroke-red-500',
  untested: 'fill-muted stroke-border',
}

export function KlpGraphCanvas({
  klps,
  relations,
  answer,
  activeIndex,
  onActiveChange,
  hoveredEdgeId,
  onHoveredEdgeChange,
  selectedEdgeId,
  onSelectedEdgeChange,
  kLabel,
  rLabel,
}: KlpGraphCanvasProps) {
  const [overrides, setOverrides] = useState<PositionOverrides>({})
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [showAnswer, setShowAnswer] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<
    | { kind: 'node'; index: number; startX: number; startY: number; originX: number; originY: number }
    | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
    | null
  >(null)

  const base = useMemo(() => layoutKlpGraph(klps.length, relations), [klps.length, relations])
  const nodes = useMemo(() => applyOverrides(base.nodes, overrides), [base.nodes, overrides])
  const extent = useMemo(() => graphExtent(nodes), [nodes])

  const drawable = useMemo(
    () => relations.filter((r) => r.from < klps.length && r.to < klps.length && r.from !== r.to),
    [relations, klps.length],
  )

  const overlay = showAnswer ? answer : null

  const fit = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setScale(fitScale(extent.width, extent.height, rect.width - 16, rect.height - 16))
    setPan({ x: 0, y: 0 })
  }, [extent.width, extent.height])

  // Fit once the container has a real width, and again whenever it changes —
  // "fit whatever the display size is" has to survive a window resize and the
  // jump into fullscreen, not just the first paint.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => fit())
    observer.observe(el)
    return () => observer.disconnect()
  }, [fit])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  async function toggleFullscreen() {
    const el = containerRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await el.requestFullscreen()
    } catch {
      // Fullscreen is refused in some embeds and on some browsers. The graph is
      // fully usable without it, so a refusal must not break the page.
    }
  }

  function onNodePointerDown(e: React.PointerEvent, index: number) {
    e.stopPropagation()
    const node = nodes.find((n) => n.index === index)
    if (!node) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = {
      kind: 'node',
      index,
      startX: e.clientX,
      startY: e.clientY,
      originX: node.x,
      originY: node.y,
    }
  }

  function onBackgroundPointerDown(e: React.PointerEvent) {
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y }
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    // Screen pixels divided by scale gives SVG units, so a box tracks the
    // cursor exactly rather than lagging or overshooting when zoomed.
    const dx = (e.clientX - drag.startX) / scale
    const dy = (e.clientY - drag.startY) / scale

    if (drag.kind === 'node') {
      setOverrides((prev) => ({
        ...prev,
        [drag.index]: { x: Math.max(0, drag.originX + dx), y: Math.max(0, drag.originY + dy) },
      }))
    } else {
      setPan({ x: drag.originX + (e.clientX - drag.startX), y: drag.originY + (e.clientY - drag.startY) })
    }
  }

  function endDrag() {
    dragRef.current = null
  }

  const touched = useMemo(() => {
    if (activeIndex === null) return null
    const set = new Set<number>([activeIndex])
    for (const r of drawable) {
      if (r.from === activeIndex) set.add(r.to)
      if (r.to === activeIndex) set.add(r.from)
    }
    return set
  }, [activeIndex, drawable])

  const nodeDimmed = (index: number) => touched !== null && !touched.has(index)
  const edgeDimmed = (r: KlpEdge) =>
    (activeIndex !== null && r.from !== activeIndex && r.to !== activeIndex) ||
    (hoveredEdgeId !== null && hoveredEdgeId !== r.id)

  /**
   * Whether an answer overlay marks this connection as broken.
   *
   * DERIVED, NOT MEASURED, and the caption says so. Nothing yet records whether
   * a learner got the LINK wrong as opposed to its endpoints — that needs the
   * relation probes Spec 3 serves. What is known is the endpoint outcomes, so a
   * chain is flagged where a step it runs through failed. Claiming more than
   * that would invent a verdict.
   */
  function edgeBroken(r: KlpEdge): boolean {
    if (!overlay) return false
    return outcomeOf(overlay.statuses[r.from]) === 'wrong' || outcomeOf(overlay.statuses[r.to]) === 'wrong'
  }

  if (drawable.length === 0) return null

  return (
    <div
      ref={containerRef}
      className={`relative rounded border bg-background ${fullscreen ? 'h-screen w-screen' : 'h-[420px]'}`}
    >
      <div className="absolute right-2 top-2 z-10 flex flex-wrap items-center gap-1">
        {answer && (
          <div className="mr-1 flex overflow-hidden rounded border text-xs">
            <button
              type="button"
              onClick={() => setShowAnswer(false)}
              aria-pressed={!showAnswer}
              className={`px-2 py-1 ${!showAnswer ? 'bg-muted font-medium' : ''}`}
            >
              Solution
            </button>
            <button
              type="button"
              onClick={() => setShowAnswer(true)}
              aria-pressed={showAnswer}
              className={`px-2 py-1 ${showAnswer ? 'bg-muted font-medium' : ''}`}
            >
              {answer.label}
            </button>
          </div>
        )}
        <button type="button" onClick={() => setScale((s) => clampScale(s * 1.2))} className="rounded border px-2 py-1 text-xs" aria-label="Zoom in">+</button>
        <button type="button" onClick={() => setScale((s) => clampScale(s / 1.2))} className="rounded border px-2 py-1 text-xs" aria-label="Zoom out">&minus;</button>
        <button type="button" onClick={fit} className="rounded border px-2 py-1 text-xs">Fit</button>
        <button
          type="button"
          onClick={() => setOverrides({})}
          className="rounded border px-2 py-1 text-xs"
          disabled={Object.keys(overrides).length === 0}
        >
          Reset
        </button>
        <button type="button" onClick={toggleFullscreen} className="rounded border px-2 py-1 text-xs">
          {fullscreen ? 'Exit' : 'Full screen'}
        </button>
      </div>

      <svg
        width="100%"
        height="100%"
        className="cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        role="img"
        aria-label="Relation graph"
      >
        <defs>
          <marker id="klp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-teal-600 dark:fill-teal-400" />
          </marker>
          <marker id="klp-arrow-confusion" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-orange-600 dark:fill-orange-400" />
          </marker>
          <marker id="klp-arrow-broken" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-red-600 dark:fill-red-500" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
          {drawable.map((r, i) => {
            const from = nodes.find((n) => n.index === r.from)!
            const to = nodes.find((n) => n.index === r.to)!
            const geo = edgeGeometry(from, to)
            const style = RELATION_STYLE[r.type] ?? RELATION_STYLE.causes
            const broken = edgeBroken(r)
            const confusion = style.tone === 'confusion'
            const marker = broken ? 'klp-arrow-broken' : confusion ? 'klp-arrow-confusion' : 'klp-arrow'
            return (
              <g
                key={r.id}
                className={`cursor-pointer transition-opacity ${edgeDimmed(r) ? 'opacity-15' : ''}`}
                onClick={() => onSelectedEdgeChange(selectedEdgeId === r.id ? null : r.id)}
                onMouseEnter={() => onHoveredEdgeChange(r.id)}
                onMouseLeave={() => onHoveredEdgeChange(null)}
              >
                <path d={geo.path} fill="none" stroke="transparent" strokeWidth={14} />
                <path
                  d={geo.path}
                  fill="none"
                  strokeWidth={selectedEdgeId === r.id || broken ? 2.5 : 1.5}
                  strokeDasharray={style.dash}
                  markerEnd={`url(#${marker})`}
                  markerStart={confusion ? `url(#${marker})` : undefined}
                  className={
                    broken
                      ? 'stroke-red-600 dark:stroke-red-500'
                      : confusion
                        ? 'stroke-orange-600 dark:stroke-orange-400'
                        : 'stroke-teal-600 dark:stroke-teal-400'
                  }
                />
                <text x={geo.labelX} y={geo.labelY} textAnchor="middle" className="fill-muted-foreground font-mono" style={{ fontSize: 10 }}>
                  {rLabel(i)}
                </text>
              </g>
            )
          })}

          {nodes.map((n) => {
            const klp = klps[n.index]
            const outcome = overlay ? outcomeOf(overlay.statuses[n.index]) : 'untested'
            return (
              <g
                key={klp.id}
                transform={`translate(${n.x} ${n.y})`}
                className={`cursor-move transition-opacity ${nodeDimmed(n.index) ? 'opacity-25' : ''}`}
                onPointerDown={(e) => onNodePointerDown(e, n.index)}
                onMouseEnter={() => onActiveChange(n.index)}
                onMouseLeave={() => onActiveChange(null)}
              >
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={8}
                  className={overlay ? NODE_FILL[outcome] : 'fill-muted stroke-border'}
                  strokeWidth={activeIndex === n.index ? 2 : 1}
                />
                <text x={10} y={20} className="fill-teal-700 dark:fill-teal-400 font-mono" style={{ fontSize: 11 }}>
                  {kLabel(n.index)}
                </text>
                <text x={10} y={38} className="fill-foreground" style={{ fontSize: 11 }}>
                  {truncate(klp.label ?? klp.text, 26)}
                </text>
                <text x={10} y={52} className="fill-muted-foreground font-mono" style={{ fontSize: 9 }}>
                  {overlay ? outcome : `${klp.kind} · w${klp.weight}`}
                </text>
                <title>{klp.text}</title>
              </g>
            )
          })}
        </g>
      </svg>

      {overlay && (
        <p className="absolute bottom-2 left-2 max-w-[90%] text-[11px] text-muted-foreground">
          Node colour is this learner&rsquo;s measured result per key point. A red LINE is inferred
          from its endpoints, not measured &mdash; nothing yet records whether the connection itself
          was got wrong.
        </p>
      )}
    </div>
  )
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
