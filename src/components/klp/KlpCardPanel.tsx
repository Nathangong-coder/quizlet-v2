'use client'

import { useMemo, useState } from 'react'
import { RELATION_STYLE } from '@/lib/klp/graph-layout'
import { KlpGraphCanvas, type AnswerOverlay } from '@/components/klp/KlpGraphCanvas'
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
  /** When present, the graph offers a Solution / learner-answer toggle. */
  answer?: AnswerOverlay | null
  /**
   * Admins see the authoring diagnostics — separation score, low-discrimination
   * flag. A learner reading their own set does not: those numbers grade the
   * QUESTION rather than the reader, and a "low discrimination 0.13" badge on
   * someone's study material reads as a verdict on them.
   */
  isAdmin?: boolean
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
  answer,
  isAdmin = false,
}: KlpCardPanelProps) {
  const [active, setActive] = useState<number | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)

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
        <h3 className="text-base font-medium leading-6">{cardTerm}</h3>
        {cardDefinition && <p className="text-xs text-muted-foreground">{cardDefinition}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-muted-foreground">
          <span>{klps.length} key points</span>
          <span aria-hidden>&middot;</span>
          <span>{drawable.length} connections</span>
          {isAdmin && typeof separation === 'number' && (
            <>
              <span aria-hidden>&middot;</span>
              <span className="font-mono tabular-nums" title="How far the correct answer outscored the best deliberately-wrong one. Higher is better; below 0.40 is flagged.">
                separation {separation.toFixed(2)}
              </span>
            </>
          )}
          {isAdmin && status === 'low_discrimination' && (
            <span
              className="rounded-full border border-amber-600/40 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
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
              <span className="shrink-0 pt-px font-mono text-xs text-teal-700 dark:text-teal-400">
                {kLabel(i)}
              </span>
              <span className="text-sm leading-6">{k.text}</span>
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
        <KlpGraphCanvas
          klps={klps}
          relations={relations}
          answer={answer}
          activeIndex={active}
          onActiveChange={setActive}
          hoveredEdgeId={hoveredEdge}
          onHoveredEdgeChange={setHoveredEdge}
          selectedEdgeId={selectedEdge}
          onSelectedEdgeChange={setSelectedEdge}
          kLabel={kLabel}
          rLabel={rLabel}
        />
      )}

      {/* CAPTIONS. An R-number on a line says an edge exists and nothing about
          what it claims. The rationale is that connection in words, and it is
          already stored, so it is shown outright rather than hidden.

          The layout does the work the earlier version made the reader do: the
          endpoints read as a single K1 -> K2 chip so the eye lands on the
          relationship before the prose, the type is a coloured pill rather than
          a third monospace run, and the rationale gets its own line at reading
          width. Same information, fewer things competing for the same spot. */}
      {drawable.length > 0 && (
        <dl className="space-y-1">
          {drawable.map((r, i) => {
            const style = RELATION_STYLE[r.type] ?? RELATION_STYLE.causes
            const dimmed = edgeDimmed(r)
            const open = selectedEdge === r.id
            const confusion = style.tone === 'confusion'
            return (
              <div
                key={r.id}
                className={`rounded-md border border-transparent px-2 py-1.5 transition-colors ${
                  dimmed ? 'opacity-40' : ''
                } ${open ? 'border-border bg-muted/50' : 'hover:bg-muted/40'}`}
                onMouseEnter={() => setHoveredEdge(r.id)}
                onMouseLeave={() => setHoveredEdge(null)}
              >
                <dt className="flex items-center gap-2">
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {rLabel(i)}
                  </span>
                  <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                    {kLabel(r.from)}
                    <span aria-hidden className={confusion ? 'text-orange-600 dark:text-orange-400' : 'text-teal-600 dark:text-teal-400'}>
                      {confusion ? '↔' : '→'}
                    </span>
                    {kLabel(r.to)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      confusion
                        ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400'
                        : 'bg-teal-500/10 text-teal-700 dark:text-teal-400'
                    }`}
                  >
                    {r.type.replace(/_/g, ' ')}
                  </span>
                  <button
                    type="button"
                    className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setSelectedEdge((prev) => (prev === r.id ? null : r.id))}
                    aria-expanded={open}
                    title="A wrong answer that gets both points right but the connection between them wrong"
                  >
                    {open ? 'Hide test' : 'Test it'}
                  </button>
                </dt>
                <dd className="mt-1 max-w-prose pl-1 text-sm leading-6 text-muted-foreground">
                  {r.rationale}
                </dd>
                {open && (
                  <dd className="mt-2 max-w-prose rounded border-l-2 border-l-muted-foreground/40 bg-background/60 px-3 py-2 text-sm leading-6">
                    <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Gets both points right, the link wrong
                    </span>
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
