'use client'

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { PenLine, ListChecks, Network, Sparkles, Brain, Stethoscope } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The signed-out feature showcase: a tab per way of studying, each with a
 * claim, two sentences, and a mock panel drawn in CSS.
 *
 * MOCKS, NOT SCREENSHOTS, on purpose. A screenshot goes stale on the next
 * design pass and would show a real learner's data; a drawn panel shows the
 * SHAPE of the feature and nothing else. Every panel below is static markup
 * — no fetch, no store — so `Landing` stays a page that renders for every
 * anonymous hit without a database read.
 *
 * PUBLIC-FACING COPY. This is the one surface a competitor can read without an
 * account, so it names WHAT the app does (grades against points, not a
 * definition; a concept tree; insights across sessions; memory that only moves
 * on evidence) and never HOW. Nothing here should describe the authoring
 * pipeline, the scoring model, the vocabularies, or which models are used.
 */

export interface ShowcaseTab {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  claim: string
  body: string
  panel: React.ReactNode
}

function Verdict({ state, children }: { state: 'hit' | 'partial' | 'miss'; children: React.ReactNode }) {
  const mark = state === 'hit' ? '✓' : state === 'partial' ? '½' : '–'
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
          state === 'hit' && 'bg-success',
          state === 'partial' && 'bg-warning',
          state === 'miss' && 'bg-muted-foreground/60',
        )}
      >
        {mark}
      </span>
      <span className="text-foreground/90">{children}</span>
    </li>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="label mb-3">{title}</div>
      {children}
    </div>
  )
}

const TABS: ShowcaseTab[] = [
  {
    id: 'short-answer',
    label: 'Short answer',
    icon: PenLine,
    claim: 'Write the answer. Get told exactly which idea you missed.',
    body: 'Every card carries the handful of ideas a good answer has to contain. Your answer is read against each one and comes back with the sentence that earned or lost it — not a bare score.',
    panel: (
      <Panel title="Your answer, read point by point">
        <p className="mb-3 text-sm italic text-muted-foreground">
          &ldquo;Cash goes up by 100 and debt goes up by 100, so net debt is the same. EV stays flat.&rdquo;
        </p>
        <ul className="space-y-1.5">
          <Verdict state="hit">Cash and debt both rise by the same amount</Verdict>
          <Verdict state="hit">Net debt is unchanged</Verdict>
          <Verdict state="hit">Enterprise value does not change</Verdict>
          <Verdict state="partial">
            EV is independent of capital structure <span className="text-muted-foreground">— conclusion present, reason missing</span>
          </Verdict>
        </ul>
      </Panel>
    ),
  },
  {
    id: 'key-points',
    label: 'Key points',
    icon: ListChecks,
    claim: 'See what a card actually teaches, before you are tested on it.',
    body: 'Each card is broken into its key points, with the ones that matter most marked. Open any card to see the list, how the points depend on each other, and which ones you have already shown you know.',
    panel: (
      <Panel title="Key points · Working capital">
        <ol className="space-y-2 text-sm">
          {[
            ['A rise in working capital is a use of cash', 5],
            ['Operating current assets and liabilities only — cash and debt are excluded', 4],
            ['The change flows through cash from operations, not investing', 3],
            ['Growing companies typically consume cash through working capital', 2],
          ].map(([text, w], i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="mt-1 flex shrink-0 gap-0.5" aria-label={`weight ${w} of 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={cn('h-2 w-1.5 rounded-sm', n <= (w as number) ? 'bg-primary' : 'bg-muted')} />
                ))}
              </span>
              <span className="text-foreground/90">{text}</span>
            </li>
          ))}
        </ol>
      </Panel>
    ),
  },
  {
    id: 'concept-tree',
    label: 'Concept tree',
    icon: Network,
    claim: 'Mastery by topic, not by card.',
    body: 'Key points roll up into a tree of concepts for each subject. Shading shows where you are solid and where the tree goes dark — so you can see that the gap is "non-cash adjustments", not "card 37".',
    panel: (
      <Panel title="Accounting · shaded by what you know">
        <svg viewBox="0 0 320 150" className="h-auto w-full" role="img" aria-label="A small concept tree: a root node with three children; two are shaded solid and one is faint, marking the weak topic.">
          <g stroke="currentColor" strokeWidth="1.2" className="text-border">
            <path d="M160 32 V60 M160 60 H60 V88 M160 60 V88 M160 60 H260 V88" fill="none" />
            <path d="M60 112 V126 M260 112 V126" fill="none" />
          </g>
          <g className="font-sans" fontSize="10.5">
            <rect x="105" y="8" width="110" height="24" rx="6" className="fill-primary" />
            <text x="160" y="24" textAnchor="middle" className="fill-primary-foreground font-semibold">Three statements</text>
            <rect x="12" y="88" width="96" height="24" rx="6" className="fill-primary/85" />
            <text x="60" y="104" textAnchor="middle" className="fill-primary-foreground">Income statement</text>
            <rect x="112" y="88" width="96" height="24" rx="6" className="fill-primary/25" />
            <text x="160" y="104" textAnchor="middle" className="fill-foreground">Cash flow</text>
            <rect x="212" y="88" width="96" height="24" rx="6" className="fill-primary/75" />
            <text x="260" y="104" textAnchor="middle" className="fill-primary-foreground">Balance sheet</text>
            <rect x="24" y="126" width="72" height="20" rx="5" className="fill-primary/70" />
            <text x="60" y="140" textAnchor="middle" className="fill-primary-foreground">Margins</text>
            <rect x="224" y="126" width="72" height="20" rx="5" className="fill-primary/60" />
            <text x="260" y="140" textAnchor="middle" className="fill-primary-foreground">Net debt</text>
            <text x="160" y="130" textAnchor="middle" className="fill-muted-foreground" fontSize="9.5">← the gap</text>
          </g>
        </svg>
      </Panel>
    ),
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: Sparkles,
    claim: 'Patterns you cannot see one quiz at a time.',
    body: 'After each session, and across all of them, synapseHQ names what keeps happening: the pair of ideas you confuse, the topic that fades fastest, the answers that were right but too thin to count as knowing.',
    panel: (
      <Panel title="From your last three sessions">
        <ul className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
            <span><span className="font-medium">Recurring confusion.</span> You describe <em>enterprise value</em> using the definition of <em>equity value</em> — 3 times, 2 sessions.</span>
          </li>
          <li className="flex gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span><span className="font-medium">Fades fastest.</span> Deferred tax — right on the day, wrong a week later. Due again tomorrow.</span>
          </li>
          <li className="flex gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
            <span><span className="font-medium">Solid.</span> Nothing in <em>LBO mechanics</em> has slipped in 30 days.</span>
          </li>
        </ul>
      </Panel>
    ),
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: Brain,
    claim: 'Confidence that only moves when you earn it.',
    body: 'Every answer, in every mode, updates what the app believes you know about each idea — and it knows a lucky multiple-choice pick proves less than a written answer. Forget a card and the evidence is erased, not just the estimate.',
    panel: (
      <Panel title="One idea, over time">
        <svg viewBox="0 0 320 120" className="h-auto w-full" role="img" aria-label="A line rising over six observations from a low starting belief to a high one, dipping once after a wrong written answer.">
          <g className="text-border" stroke="currentColor" strokeWidth="1">
            <path d="M30 100 H310 M30 60 H310 M30 20 H310" fill="none" strokeDasharray="2 4" />
          </g>
          <g className="font-mono" fontSize="9" fill="currentColor">
            <text x="24" y="103" textAnchor="end" className="fill-muted-foreground">0</text>
            <text x="24" y="63" textAnchor="end" className="fill-muted-foreground">½</text>
            <text x="24" y="23" textAnchor="end" className="fill-muted-foreground">1</text>
          </g>
          <path d="M40 82 L85 62 L130 48 L175 78 L220 58 L265 30 L300 22" fill="none" className="stroke-primary" strokeWidth="2" strokeLinejoin="round" />
          {[
            [40, 82], [85, 62], [130, 48], [175, 78], [220, 58], [265, 30], [300, 22],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i === 6 ? 4 : 3} className={i === 0 ? 'fill-card stroke-primary' : 'fill-primary'} strokeWidth="2" />
          ))}
          <g className="font-sans fill-muted-foreground" fontSize="9">
            <text x="85" y="114" textAnchor="middle">MC ✓</text>
            <text x="130" y="114" textAnchor="middle">T/F ✓</text>
            <text x="175" y="114" textAnchor="middle">written ✗</text>
            <text x="220" y="114" textAnchor="middle">written ½</text>
            <text x="265" y="114" textAnchor="middle">written ✓</text>
            <text x="300" y="114" textAnchor="middle">✓</text>
          </g>
        </svg>
      </Panel>
    ),
  },
  {
    id: 'diagnostic',
    label: 'Diagnostic',
    icon: Stethoscope,
    claim: 'Find out what you actually know before you start.',
    body: 'A short written diagnostic across a subject seeds your memory on day one, so your first study session already targets the gaps instead of walking you through what you know.',
    panel: (
      <Panel title="Diagnostic · Valuation · 8 questions">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {['hit', 'hit', 'partial', 'miss', 'hit', 'miss', 'partial', 'hit'].map((s, i) => (
            <div
              key={i}
              className={cn(
                'flex aspect-square items-center justify-center rounded-md text-xs font-semibold',
                s === 'hit' && 'bg-success-subtle text-success',
                s === 'partial' && 'bg-warning-subtle text-warning',
                s === 'miss' && 'bg-muted text-muted-foreground',
              )}
              aria-label={`question ${i + 1}: ${s}`}
            >
              {i + 1}
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Two gaps found: <span className="text-foreground">DCF terminal value</span> and <span className="text-foreground">comparable selection</span>. Your first session starts there.</p>
      </Panel>
    ),
  },
]

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
          <h3 className="font-heading text-xl font-bold tracking-tight text-balance sm:text-2xl">{current.claim}</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{current.body}</p>
        </div>
        <div>{current.panel}</div>
      </div>
    </div>
  )
}
