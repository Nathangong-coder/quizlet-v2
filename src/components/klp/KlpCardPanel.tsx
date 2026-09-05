'use client'

import { useMemo, useState } from 'react'
import {
  layoutKlpGraph,
  edgeGeometry,
  RELATION_STYLE,
  NODE_WIDTH,
  NODE_HEIGHT,
} from '@/lib/klp/graph-layout'
import type { RelationEdge } from '@/lib/klp/relations'

export interface KlpNode {
  id: string
  /** The full proposition. */
  text: string
  /** The 3-6 word rendering, when the topic pass has produced one. */
  label: string | null
  kind: string
  weight: number
}

export interface KlpEdge extends RelationEdge {
  id: string
  rationale: string
  probe: string
}

export interface KlpCardPanelProps {
  cardTerm: string
  cardDefinition?: string | null
  klps: KlpNode[]
  relations: KlpEdge[]
  /** Shown beside the card title when the card has been through authoring. */
  separation?: number | null
  status?: string | null
}

/** K1, K2, … — 1-based, because nobody reading a list counts from zero. */
function kLabel(index: number): string {
  return `K${index + 1}`
}

/** R1, R2, … in the order the relations were extracted. */
function rLabel(index: number): string {
  return `R${index + 1}`
}

/**
 * One card's key points: the numbered list, and the same points drawn as the
 * graph their relations describe.
 *
 * THE TWO HALVES ARE ONE CONTROL. Hovering K3 in the list dims everything in
 * the graph that K3 does not touch, and hovering a box does the same to the
 * list. That is the entire point of showing both — a list says what the points
 * ARE and a graph says how they HANG TOGETHER, and the reader's actual question
 * ("which of these depends on which?") lives in the join between them.
 *
 * Everything renders from real `KlpRelation` rows. A card whose relate call
 * produced nothing gets the list and an honest note rather than an empty box:
 * an enumeration card genuinely has no dependencies, and drawing a graph with
 * no edges would suggest the extraction failed.
 */
export function KlpCardPanel({
  cardTerm,
  cardDefinition,
  klps,
  relations,
  separation,
  status,
}: KlpCardPanelProps) {
  const [active, setActive] = useState<number | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)

  const layout = useMemo(() => layoutKlpGraph(klps.length, relations), [klps.length, relations])

  // Only edges whose endpoints both exist can be drawn. Out-of-range endpoints
  // are pruned before persistence, so this is belt-and-braces — but a bad row
  // must degrade to a missing line, never to a crashed page.
  const drawable = useMemo(
    () => relations.filter((r) => r.from < klps.length && r.to < klps.length && r.from !== r.to),
    [relations, klps.length],
  )

  const touched = useMemo(() => {
    if (active === null) return null
    const set = new Set<number>([active])
    for (const r of drawable) {
      if (r.from === active) set.add(r.to)
      if (r.to === active) set.add(r.from)
    }
    return set
  }, [active, drawable])

  const isDimmed = (index: number) => touched !== null && !touched.has(index)
  const edgeDimmed = (r: KlpEdge) =>
    (active !== null && r.from !== active && r.to !== active) ||
    (hoveredEdge !== null && hoveredEdge !== r.id)

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <header className="space-y-1">
        <h3 className="font-medium">{cardTerm}</h3>
        {cardDefinition && <p className="text-xs text-muted-foreground">{cardDefinition}</p>}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{klps.length} key points</span>
          <span>{drawable.length} relations</span>
          {typeof separation === 'number' && (
            <span className="font-mono tabular-nums">separation {separation.toFixed(2)}</span>
          )}
          {status === 'low_discrimination' && (
            <span
              className="rounded border border-amber-600/40 px-1.5 font-mono text-amber-700 dark:text-amber-400"
              title="The best wrong answer scored nearly as well as the right one, so these points do not yet tell them apart."
            >
              low discrimination
            </span>
          )}
        </div>
      </header>

      {/* The list. Numbered, monospaced keys, full proposition text — the shape
          a reader can scan without decoding anything. */}
      <ol className="space-y-1">
        {klps.map((k, i) => (
          <li key={k.id}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive((prev) => (prev === i ? null : i))}
              aria-pressed={active === i}
              className={`flex w-full gap-3 rounded px-1.5 py-1 text-left text-sm transition-opacity hover:bg-muted/60 ${
                isDimmed(i) ? 'opacity-40' : ''
              }`}
            >
              <span className="shrink-0 font-mono text-xs text-teal-700 dark:text-teal-400">{kLabel(i)}</span>
              <span className="font-mono text-xs leading-5">{k.text}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                w{k.weight}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {drawable.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No relations on this card. That is a real finding rather than a gap when the points are
          parallel &mdash; an enumeration has nothing to derive from anything else.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height + 40}`}
            width={layout.width}
            height={layout.height + 40}
            className="max-w-full"
            role="img"
            aria-label={`Relation graph for ${cardTerm}`}
          >
            <defs>
              <marker id="klp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-teal-600 dark:fill-teal-400" />
              </marker>
              <marker id="klp-arrow-confusion" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-orange-600 dark:fill-orange-400" />
              </marker>
            </defs>

            {drawable.map((r, i) => {
              const from = layout.nodes[r.from]
              const to = layout.nodes[r.to]
              const geo = edgeGeometry(from, to)
              const style = RELATION_STYLE[r.type] ?? RELATION_STYLE.causes
              const confusion = style.tone === 'confusion'
              const dimmed = edgeDimmed(r)
              return (
                <g
                  key={r.id}
                  className={`cursor-pointer transition-opacity ${dimmed ? 'opacity-15' : ''}`}
                  onClick={() => setSelectedEdge((prev) => (prev === r.id ? null : r.id))}
                  onMouseEnter={() => setHoveredEdge(r.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                >
                  {/* A wide transparent path under the visible one, so a 1.5px
                      line is still clickable without demanding pixel accuracy. */}
                  <path d={geo.path} fill="none" stroke="transparent" strokeWidth={14} />
                  <path
                    d={geo.path}
                    fill="none"
                    strokeWidth={selectedEdge === r.id ? 2.5 : 1.5}
                    strokeDasharray={style.dash}
                    markerEnd={`url(#${confusion ? 'klp-arrow-confusion' : 'klp-arrow'})`}
                    markerStart={confusion ? `url(#klp-arrow-confusion)` : undefined}
                    className={
                      confusion
                        ? 'stroke-orange-600 dark:stroke-orange-400'
                        : 'stroke-teal-600 dark:stroke-teal-400'
                    }
                  />
                  <text
                    x={geo.labelX}
                    y={geo.labelY}
                    textAnchor="middle"
                    className="fill-muted-foreground font-mono"
                    style={{ fontSize: 10 }}
                  >
                    {rLabel(i)}
                  </text>
                </g>
              )
            })}

            {layout.nodes.map((n) => {
              const klp = klps[n.index]
              return (
                <g
                  key={klp.id}
                  transform={`translate(${n.x} ${n.y})`}
                  className={`cursor-pointer transition-opacity ${isDimmed(n.index) ? 'opacity-25' : ''}`}
                  onMouseEnter={() => setActive(n.index)}
                  onMouseLeave={() => setActive(null)}
                  onClick={() => setActive((prev) => (prev === n.index ? null : n.index))}
                >
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={8}
                    className={`fill-muted stroke-border ${active === n.index ? 'stroke-teal-500' : ''}`}
                    strokeWidth={active === n.index ? 2 : 1}
                  />
                  <text x={10} y={20} className="fill-teal-700 dark:fill-teal-400 font-mono" style={{ fontSize: 11 }}>
                    {kLabel(n.index)}
                  </text>
                  <text x={10} y={38} className="fill-foreground" style={{ fontSize: 11 }}>
                    {truncate(klp.label ?? klp.text, 26)}
                  </text>
                  <text x={10} y={52} className="fill-muted-foreground font-mono" style={{ fontSize: 9 }}>
                    {klp.kind} · w{klp.weight}
                  </text>
                  <title>{klp.text}</title>
                </g>
              )
            })}
          </svg>
        </div>
      )}

      {drawable.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {Array.from(new Set(drawable.map((r) => r.type))).map((type) => {
            const style = RELATION_STYLE[type] ?? RELATION_STYLE.causes
            return (
              <span key={type} className="flex items-center gap-1.5">
                <svg width="26" height="8" aria-hidden>
                  <line
                    x1="0"
                    y1="4"
                    x2="26"
                    y2="4"
                    strokeWidth="1.5"
                    strokeDasharray={style.dash}
                    className={
                      style.tone === 'confusion'
                        ? 'stroke-orange-600 dark:stroke-orange-400'
                        : 'stroke-teal-600 dark:stroke-teal-400'
                    }
                  />
                </svg>
                <span className="font-mono">{type}</span>
                <span>&mdash; {style.description}</span>
              </span>
            )
          })}
        </div>
      )}

      {/* CAPTIONS. An R-number on a line tells you an edge exists and nothing
          about what it claims — the reader still has to guess why K3 points at
          K4. The rationale is the intended connection stated in words, and it
          is already stored on every relation, so it is shown outright rather
          than hidden behind a click.

          The probe stays click-to-open, because it is a different kind of
          thing: not what the link means, but the wrong answer that proves the
          link carries information — one that gets BOTH endpoints right and the
          connection wrong. That is worth reading deliberately, not while
          scanning. */}
      {drawable.length > 0 && (
        <dl className="space-y-1.5 text-xs">
          {drawable.map((r, i) => {
            const style = RELATION_STYLE[r.type] ?? RELATION_STYLE.causes
            const dimmed = edgeDimmed(r)
            const open = selectedEdge === r.id
            return (
              <div
                key={r.id}
                className={`rounded px-1.5 py-1 transition-opacity ${dimmed ? 'opacity-40' : ''} ${
                  open ? 'bg-muted/60' : ''
                }`}
                onMouseEnter={() => setHoveredEdge(r.id)}
                onMouseLeave={() => setHoveredEdge(null)}
              >
                <dt className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-muted-foreground">{rLabel(i)}</span>
                  <span className="font-mono">
                    {kLabel(r.from)} &rarr; {kLabel(r.to)}
                  </span>
                  <span
                    className={`font-mono ${
                      style.tone === 'confusion'
                        ? 'text-orange-700 dark:text-orange-400'
                        : 'text-teal-700 dark:text-teal-400'
                    }`}
                  >
                    {r.type}
                  </span>
                  <button
                    type="button"
                    className="ml-auto text-muted-foreground underline decoration-dotted"
                    onClick={() => setSelectedEdge((prev) => (prev === r.id ? null : r.id))}
                    aria-expanded={open}
                  >
                    {open ? 'hide probe' : 'probe'}
                  </button>
                </dt>
                <dd className="mt-0.5 leading-5">{r.rationale}</dd>
                {open && (
                  <dd className="mt-1 border-l-2 pl-2 text-muted-foreground">
                    <span className="font-medium">Probe: </span>
                    {r.probe}
                  </dd>
                )}
              </div>
            )
          })}
        </dl>
      )}
    </section>
  )
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
