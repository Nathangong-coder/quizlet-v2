import type { ReactNode } from 'react'
import { Star, ChevronLeft, ChevronRight, Lock, Skull, DoorOpen, Footprints } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MOCK_IDS, type MockId } from './mock-ids'

export { MOCK_IDS, type MockId }

/**
 * Every drawn panel the signed-out surfaces show.
 *
 * MOCKS, NOT SCREENSHOTS, on purpose. A screenshot goes stale on the next
 * design pass and would show a real learner's data; a drawn panel shows the
 * SHAPE of the feature and nothing else. Every panel is static markup — no
 * fetch, no store, no hooks — so the landing and the feature pages render for
 * every anonymous hit without a database read.
 *
 * PUBLIC-FACING. A panel names WHAT a feature does and never HOW. Nothing here
 * describes the authoring pipeline, the scoring model, the vocabularies, or
 * which models are used. Learn and Study guides are not built; their panels
 * are what they will look like and the pages say so.
 */

// ---------------------------------------------------------------- primitives

function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4 sm:p-5', className)}>
      <div className="label mb-3">{title}</div>
      {children}
    </div>
  )
}

function Verdict({ state, children }: { state: 'hit' | 'partial' | 'miss'; children: ReactNode }) {
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

function Weight({ w }: { w: number }) {
  return (
    <span className="mt-1 flex shrink-0 gap-0.5" aria-label={`weight ${w} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={cn('h-2 w-1.5 rounded-sm', n <= w ? 'bg-primary' : 'bg-muted')} />
      ))}
    </span>
  )
}

function Chip({ tone, children }: { tone: 'violet' | 'teal' | 'amber' | 'rose'; children: ReactNode }) {
  const tones = {
    violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
    teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    rose: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  }
  return <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium', tones[tone])}>{children}</span>
}

function Toggle({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between py-1.5 text-sm">
      <span>{children}</span>
      <span aria-hidden="true" className={cn('relative inline-block h-4 w-7 rounded-full transition-colors', on ? 'bg-primary' : 'bg-muted')}>
        <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white', on ? 'left-3.5' : 'left-0.5')} />
      </span>
    </li>
  )
}

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{label}</span><span className="metric">{value}</span></div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label} ${value} of 100`}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function Line({ w = 'w-full', className }: { w?: string; className?: string }) {
  return <div className={cn('h-2 rounded bg-muted', w, className)} aria-hidden="true" />
}

// -------------------------------------------------------------------- shared

const shortAnswer = (
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
)

const keyPoints = (
  <Panel title="Key points · Working capital">
    <ol className="space-y-2 text-sm">
      {[
        ['A rise in working capital is a use of cash', 5],
        ['Operating current assets and liabilities only — cash and debt are excluded', 4],
        ['The change flows through cash from operations, not investing', 3],
        ['Growing companies typically consume cash through working capital', 2],
      ].map(([text, w], i) => (
        <li key={i} className="flex items-start gap-3">
          <Weight w={w as number} />
          <span className="text-foreground/90">{text}</span>
        </li>
      ))}
    </ol>
  </Panel>
)

const conceptTree = (
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
)

const insights = (
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
)

const memory = (
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
      {[[40, 82], [85, 62], [130, 48], [175, 78], [220, 58], [265, 30], [300, 22]].map(([x, y], i) => (
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
)

const diagnostic = (
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
)

// ---------------------------------------------------------------- flashcards

const carousel = (
  <Panel title="Flashcards · Accounting · 3 of 48">
    <div className="flex items-center gap-3">
      <span className="rounded-full border border-border p-1.5 text-muted-foreground" aria-hidden="true"><ChevronLeft className="h-4 w-4" /></span>
      <div className="relative flex-1" style={{ perspective: '800px' }}>
        <div className="rounded-lg border border-border bg-background px-5 py-8 text-center shadow-[var(--shadow-sm)]" style={{ transform: 'rotateY(-8deg)' }}>
          <div className="label mb-2">Term</div>
          <div className="font-heading text-lg font-bold">Deferred tax liability</div>
          <div className="mt-3 flex justify-center gap-1.5"><Chip tone="violet">accounting</Chip><Chip tone="teal">talking</Chip></div>
        </div>
        <div className="absolute -right-2 -top-2 rounded-full bg-warning p-1 text-white" aria-label="starred"><Star className="h-3 w-3 fill-current" /></div>
      </div>
      <span className="rounded-full border border-border p-1.5 text-muted-foreground" aria-hidden="true"><ChevronRight className="h-4 w-4" /></span>
    </div>
    <p className="mt-3 text-center text-xs text-muted-foreground">click to flip</p>
  </Panel>
)

const termsList = (
  <Panel title="48 cards">
    <ul className="divide-y divide-border text-sm">
      {[
        ['Deferred tax liability', 'Tax owed later because book and tax depreciation differ…', ['violet', 'accounting'], 8, true],
        ['Working capital', 'Operating current assets less operating current liabilities…', ['violet', 'accounting'], 4, false],
        ['Walk me through a DCF', 'Project unlevered free cash flow, discount at WACC, add…', ['teal', 'talking'], 6, true],
      ].map(([term, def, chip, conf, star], i) => (
        <li key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-3 py-2">
          <span className="font-medium">{term as string}</span>
          <span className="truncate text-muted-foreground">{def as string}</span>
          <span className="flex items-center gap-2">
            <Chip tone={(chip as string[])[0] as 'violet'}>{(chip as string[])[1]}</Chip>
            <span className="metric text-xs text-muted-foreground">{conf as number}/10</span>
            <Star className={cn('h-3.5 w-3.5', star ? 'fill-warning text-warning' : 'text-muted-foreground/40')} aria-label={star ? 'starred' : 'not starred'} />
          </span>
        </li>
      ))}
    </ul>
  </Panel>
)

const fork = (
  <Panel title="Browse · Valuation basics">
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="font-heading font-bold">Valuation basics</div>
        <div className="mt-0.5 text-xs text-muted-foreground">62 cards · by <span className="text-foreground">Alice_NG</span> · public</div>
      </div>
      <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Make a copy</span>
    </div>
    <div className="mt-4 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
      <span className="text-foreground">Your copy</span> · private · progress starts fresh · <span className="italic">copied from Valuation basics by Alice_NG</span>
    </div>
  </Panel>
)

// --------------------------------------------------------------------- learn

const lesson = (
  <Panel title="Lesson · Why non-cash charges get added back">
    <div className="space-y-3 text-sm">
      <p className="text-foreground/90">Depreciation reduces net income but no cash leaves. To get from net income back to cash, you add it back.</p>
      <div className="rounded-md bg-muted/60 p-3">
        <div className="label mb-1">Worked example</div>
        <p className="text-foreground/90">Net income 80, depreciation 20 → cash from operations starts at <span className="metric font-semibold">100</span>, before working capital.</p>
      </div>
      <div className="rounded-md border border-border p-3">
        <div className="label mb-1">Check · in your own words</div>
        <p className="italic text-muted-foreground">A company writes down goodwill by 50. What happens to cash from operations, and why?</p>
        <Line w="w-2/3" className="mt-2" />
      </div>
    </div>
  </Panel>
)

const lessonLoop = (
  <Panel title="Round 1 → 2 → 3">
    <ol className="grid grid-cols-3 gap-2 text-xs">
      {[
        ['Teach', '2 ideas', 'bg-primary/15'],
        ['Check', '1 still missing', 'bg-warning-subtle'],
        ['Teach again', 'only the missing one', 'bg-primary/15'],
      ].map(([t, s, bg], i) => (
        <li key={i} className={cn('rounded-md p-2.5', bg)}>
          <div className="font-semibold">{t}</div>
          <div className="text-muted-foreground">{s}</div>
        </li>
      ))}
    </ol>
    <div className="mt-3 rounded-md bg-success-subtle p-2.5 text-xs text-success">Check clean · 2 new cards added to your set</div>
  </Panel>
)

// -------------------------------------------------------------- study guides

const guide = (
  <Panel title="Study guide · Accounting">
    <ol className="space-y-3 text-sm">
      {[
        ['1. The three statements', 'bg-primary/80', ['How they link', 'What net income feeds']],
        ['2. Cash flow statement', 'bg-primary/25', ['Non-cash adjustments', 'Working capital changes']],
        ['3. Balance sheet', 'bg-primary/70', ['Net debt', 'Deferred taxes']],
      ].map(([h, shade, pts], i) => (
        <li key={i}>
          <div className="flex items-center gap-2 font-heading font-bold">
            <span className={cn('h-2.5 w-2.5 rounded-sm', shade as string)} aria-hidden="true" />
            {h as string}
          </div>
          <ul className="ml-4.5 mt-1 space-y-0.5 text-muted-foreground">
            {(pts as string[]).map((p) => <li key={p}>· {p}</li>)}
          </ul>
        </li>
      ))}
    </ol>
  </Panel>
)

const guidePrint = (
  <Panel title="Print preview" className="bg-background">
    <div className="mx-auto max-w-[220px] rounded-sm border border-border bg-white p-4 text-[9px] leading-relaxed text-neutral-800 shadow-[var(--shadow-md)]">
      <div className="mb-2 text-[11px] font-bold">Accounting — study guide</div>
      <div className="font-semibold">1. The three statements</div>
      <div>· How they link · What net income feeds</div>
      <div className="mt-1.5 font-semibold">2. Cash flow statement <span className="rounded bg-amber-200 px-1 font-normal">weak</span></div>
      <div>· Non-cash adjustments · Working capital</div>
      <div className="mt-1.5 font-semibold">3. Balance sheet</div>
      <div>· Net debt · Deferred taxes</div>
    </div>
  </Panel>
)

// --------------------------------------------------------------- postmortems

const postmortem = (
  <Panel title="Postmortem · Mock interview · Tue 9 Sep">
    <dl className="space-y-2 text-sm">
      <div><dt className="label">What came up</dt><dd className="text-foreground/90">Walk me through a DCF. Why does EV not change when you raise debt. Deferred tax reversals.</dd></div>
      <div><dt className="label">Gaps</dt><dd className="text-foreground/90">Froze on why DTL reverses; hand-waved terminal value.</dd></div>
      <div className="flex items-center gap-4">
        <div><dt className="label">Felt</dt><dd className="metric">3 / 5</dd></div>
        <div><dt className="label">Linked set</dt><dd className="text-primary">Accounting — Talking</dd></div>
      </div>
    </dl>
  </Panel>
)

const postmortemTrail = (
  <Panel title="Before Thursday">
    <ol className="relative ml-2 space-y-3 border-l border-border pl-4 text-sm">
      {[
        ['2 Sep', 'Paper test', 'Ran out of time on the LBO section'],
        ['9 Sep', 'Mock interview', 'Froze on why DTL reverses'],
        ['11 Sep', 'Technical test', 'DTL again — twice now'],
      ].map(([d, f, g]) => (
        <li key={d}>
          <span className="absolute -left-1 mt-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
          <div className="text-xs text-muted-foreground">{d} · {f}</div>
          <div className="text-foreground/90">{g}</div>
        </li>
      ))}
    </ol>
  </Panel>
)

const note = (
  <Panel title="Note · Superday prep">
    <div className="text-sm text-foreground/90">
      <p>Three things to say about any acquisition: strategic fit, synergies with a number attached, and what the market will think of the price…</p>
    </div>
    <div className="mt-3 rounded-md bg-muted/60 p-2.5 text-xs">
      <div className="label mb-1">Summary</div>
      <p>Fit · quantified synergies · price reaction. Original text kept below.</p>
    </div>
  </Panel>
)

// ---------------------------------------------------------------------- test

const quizSetup = (
  <Panel title="Set up your test">
    <ul className="divide-y divide-border">
      <Toggle on>Multiple choice</Toggle>
      <Toggle on>True / false</Toggle>
      <Toggle on>Written</Toggle>
      <Toggle on={false}>Matching</Toggle>
    </ul>
    <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
      <span className="rounded-full bg-primary px-2.5 py-1 font-medium text-primary-foreground">Starred only</span>
      <span className="rounded-full border border-border px-2.5 py-1">Failed last time</span>
      <span className="rounded-full border border-border px-2.5 py-1">Definition → term</span>
      <Chip tone="teal">talking</Chip>
    </div>
    <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
      <span>12 cards · print with answer key</span>
      <span className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground">Start test</span>
    </div>
  </Panel>
)

const distractors = (
  <Panel title="Which is true of a rise in working capital?">
    <ul className="space-y-1.5 text-sm">
      {[
        ['It is a use of cash', 'correct', ''],
        ['It is a source of cash', 'picked', 'sign flipped'],
        ['It flows through investing cash flow', '', 'wrong statement'],
        ['Cash is included in the calculation', '', 'condition swapped'],
      ].map(([t, s, why]) => (
        <li key={t} className={cn('flex items-center justify-between rounded-md border px-3 py-2', s === 'correct' && 'border-success bg-success-subtle', s === 'picked' && 'border-warning bg-warning-subtle', s === '' && 'border-border')}>
          <span>{t}</span>
          {why && <span className="text-xs text-muted-foreground">{why}</span>}
        </li>
      ))}
    </ul>
  </Panel>
)

// -------------------------------------------------------------------- review

const reviewCard = (
  <Panel title="Review · 14 left">
    <div className="rounded-lg border border-border bg-background px-5 py-6 text-center">
      <div className="label mb-1">Definition</div>
      <p className="text-sm text-foreground/90">Tax that will be owed later because the books recognise income before the tax return does.</p>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-semibold">
      <span className="rounded-md border border-border py-2 text-center text-muted-foreground">Don&rsquo;t know</span>
      <span className="rounded-md bg-primary py-2 text-center text-primary-foreground">Know it</span>
    </div>
    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span>confidence</span>
      <span className="flex gap-0.5" aria-label="confidence 6 of 10">
        {Array.from({ length: 10 }, (_, i) => <span key={i} className={cn('h-2 w-2 rounded-sm', i < 6 ? 'bg-primary' : 'bg-muted')} />)}
      </span>
      <span className="metric">6 → 7</span>
    </div>
  </Panel>
)

const reviewQueue = (
  <Panel title="The deck, as you go">
    <div className="flex items-end gap-1.5" role="img" aria-label="A row of cards; the ones marked don't-know move to the back of the row, and one high-confidence card retires after a single extra look.">
      {[
        ['known', 'bg-success/70'], ['known', 'bg-success/70'], ['missed', 'bg-warning'], ['known', 'bg-success/70'],
        ['missed', 'bg-warning'], ['known', 'bg-success/70'], ['up next', 'bg-muted'], ['up next', 'bg-muted'],
        ['back again', 'bg-warning/60'], ['back again', 'bg-warning/60'],
      ].map(([t, c], i) => (
        <span key={i} className={cn('h-10 flex-1 rounded-sm', c)} title={t} />
      ))}
    </div>
    <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>answered</span><span>re-queued at the end</span></div>
    <p className="mt-3 text-xs text-muted-foreground">A card you were already confident in gets one more look, then retires for the session.</p>
  </Panel>
)

const memoryHistory = (
  <Panel title="Your memory · Accounting · last 30 days">
    <div className="grid grid-cols-3 gap-2 text-center">
      {[['214', 'answers'], ['31', 'cards moved up'], ['6', 'cards moved down']].map(([n, l]) => (
        <div key={l} className="rounded-md bg-muted/60 p-2"><div className="metric text-lg font-semibold">{n}</div><div className="text-[11px] text-muted-foreground">{l}</div></div>
      ))}
    </div>
    <ul className="mt-3 space-y-1.5 text-xs">
      <li className="flex justify-between"><span>Deferred tax liability · written ✓</span><span className="text-muted-foreground">today</span></li>
      <li className="flex justify-between"><span>Working capital · review ✗</span><span className="text-muted-foreground">yesterday</span></li>
      <li className="flex justify-between"><span>Net debt · multiple choice ✓</span><span className="text-muted-foreground">Tue</span></li>
    </ul>
  </Panel>
)

// --------------------------------------------------------------------- games

const gamesHub = (
  <Panel title="Games · Accounting">
    <div className="grid grid-cols-2 gap-2 text-sm">
      {[
        ['Match', 'best 0:42', 'playable'],
        ['Gauntlet', 'reads your memory', 'coming'],
        ['Hot Seat', '5 questions · interviewer', 'coming'],
        ['Blitz', '41 short prompts ready', 'coming'],
      ].map(([n, s, st]) => (
        <div key={n} className={cn('rounded-md border p-3', st === 'playable' ? 'border-primary/50' : 'border-border')}>
          <div className="flex items-center justify-between font-heading font-bold">{n}<span className={cn('text-[10px] font-medium', st === 'playable' ? 'text-primary' : 'text-muted-foreground')}>{st}</span></div>
          <div className="text-xs text-muted-foreground">{s}</div>
        </div>
      ))}
    </div>
  </Panel>
)

const gauntlet = (
  <Panel title="Gauntlet · room 7 of 12 · ♥♥♡">
    <div className="flex items-center gap-1.5" role="img" aria-label="A row of rooms: corridors, locked doors, and three bosses at the end.">
      {[Footprints, Footprints, DoorOpen, Footprints, DoorOpen, DoorOpen, Lock, Footprints, DoorOpen, Skull, Skull, Skull].map((Icon, i) => (
        <span key={i} className={cn('flex h-8 flex-1 items-center justify-center rounded-md', i < 6 ? 'bg-success/20 text-success' : i === 6 ? 'bg-primary text-primary-foreground' : i >= 9 ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200' : 'bg-muted text-muted-foreground')}>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      ))}
    </div>
    <div className="mt-3 rounded-md border border-primary/40 p-3 text-sm">
      <div className="label mb-1">Locked door · type the answer</div>
      <p className="text-foreground/90">Why does a deferred tax liability reverse?</p>
      <Line w="w-1/2" className="mt-2" />
    </div>
    <p className="mt-2 text-xs text-muted-foreground">streak 4 · shield at 5</p>
  </Panel>
)

const hotSeat = (
  <Panel title="Hot Seat · question 3 of 5 · 0:41">
    <Meter value={62} label="interviewer mood" />
    <div className="mt-3 space-y-2 text-sm">
      <p className="rounded-md bg-muted/60 p-2.5"><span className="font-semibold">Interviewer:</span> Walk me through what happens to the three statements when depreciation goes up by 10.</p>
      <p className="rounded-md border border-border p-2.5 italic text-muted-foreground">Net income falls by 6 after tax, cash goes up by 4 because you add back the 10…</p>
      <p className="rounded-md bg-warning-subtle p-2.5"><span className="font-semibold">Interviewer:</span> And on the balance sheet — what balances the drop in PP&amp;E?</p>
    </div>
  </Panel>
)

const blitz = (
  <Panel title="Blitz · 340 pts · ×2">
    <div className="grid h-28 grid-cols-4 gap-1.5 rounded-md bg-muted/40 p-1.5" role="img" aria-label="Four lanes with prompts falling at different heights.">
      {[['WACC stands for ___', 'mt-1'], ['A rise in working capital is a ___ of cash', 'mt-10'], ['', ''], ['Depreciation is added back because it is ___', 'mt-16']].map(([t, m], i) => (
        <div key={i} className="relative">
          {t && <div className={cn('rounded bg-card px-1.5 py-1 text-[10px] leading-tight shadow-[var(--shadow-sm)]', m)}>{t}</div>}
        </div>
      ))}
    </div>
    <div className="mt-2 grid grid-cols-4 gap-1.5 text-[11px] font-medium">
      {['non-cash', 'use', 'weighted average cost of capital', 'source'].map((t) => (
        <span key={t} className="truncate rounded-md border border-border bg-card px-2 py-1.5 text-center">{t}</span>
      ))}
    </div>
  </Panel>
)

const match = (
  <Panel title="Match · 0:19">
    <div className="grid grid-cols-3 gap-1.5 text-[11px]">
      {['WACC', 'use of cash', 'Net debt', 'weighted average cost of capital', 'debt − cash', 'rise in working capital'].map((t, i) => (
        <span key={t} className={cn('flex min-h-12 items-center justify-center rounded-md border p-1.5 text-center leading-tight', i === 0 || i === 3 ? 'border-primary bg-primary/10' : 'border-border bg-card')}>{t}</span>
      ))}
    </div>
  </Panel>
)

// ------------------------------------------------------------------ registry

const MOCKS: Record<MockId, ReactNode> = {
  'short-answer': shortAnswer,
  'key-points': keyPoints,
  'concept-tree': conceptTree,
  insights,
  memory,
  diagnostic,
  carousel,
  'terms-list': termsList,
  fork,
  lesson,
  'lesson-loop': lessonLoop,
  guide,
  'guide-print': guidePrint,
  postmortem,
  'postmortem-trail': postmortemTrail,
  note,
  'quiz-setup': quizSetup,
  distractors,
  'review-card': reviewCard,
  'review-queue': reviewQueue,
  'memory-history': memoryHistory,
  'games-hub': gamesHub,
  gauntlet,
  'hot-seat': hotSeat,
  blitz,
  match,
}

export function Mock({ id }: { id: MockId }) {
  return <>{MOCKS[id]}</>
}
