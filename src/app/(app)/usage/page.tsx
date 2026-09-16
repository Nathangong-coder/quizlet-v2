import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { loadUsageDashboard, parseWindow, USAGE_WINDOWS } from '@/lib/ai/usage-dashboard'
import { PageHeader } from '@/components/ui/page-header'
import { DailyBars, TaskPie, Sparkline } from '@/components/usage/charts'
import { colourFor, fmtInt, fmtUsd } from '@/components/usage/format'
import { HistoryTable } from '@/components/usage/HistoryTable'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'AI usage' }

/**
 * `/usage` — the learner's AI spend, on its own page (owner, 2026-09-14:
 * "separate from AI settings, like DeepSeek's"). Time and key filters in the
 * URL, three headline tiles, a daily chart split by model or task, the task
 * share as a donut, one card per model, and every call labelled in a history
 * table with CSV export. All of it is one read of `AiCallLog` — see
 * `lib/ai/usage-dashboard.ts`; there is no second counter.
 */
export default async function UsagePage({ searchParams }: { searchParams: Promise<{ days?: string; key?: string }> }) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Fusage')
  const { days, key } = await searchParams
  const windowDays = parseWindow(days)
  const dash = await loadUsageDashboard(prisma, session.user.id, { windowDays, key: key && key !== 'all' ? key : null })
  const t = dash.totals
  const href = (patch: { days?: number; key?: string | null }) => {
    const q = new URLSearchParams()
    const d = patch.days ?? windowDays
    const k = patch.key === undefined ? dash.key : patch.key
    if (d !== 30) q.set('days', String(d))
    if (k) q.set('key', k)
    const s = q.toString()
    return s ? `/usage?${s}` : '/usage'
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title="AI usage" lede="Every call your keys made, what it did, and what it cost." />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex items-center rounded-full border border-border p-0.5">
          <span className="px-3 text-xs text-muted-foreground">Time</span>
          {USAGE_WINDOWS.map((d) => (
            <Link key={d} href={href({ days: d })} className={cn('rounded-full px-3 py-1 text-xs', d === windowDays ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>Last {d} days</Link>
          ))}
        </div>
        {dash.keys.length > 0 && (
          <div className="inline-flex items-center rounded-full border border-border p-0.5">
            <span className="px-3 text-xs text-muted-foreground">API key</span>
            <Link href={href({ key: null })} className={cn('rounded-full px-3 py-1 text-xs', dash.key === null ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>All</Link>
            {dash.keys.map((k) => (
              <Link key={k} href={href({ key: k })} className={cn('max-w-40 truncate rounded-full px-3 py-1 text-xs', dash.key === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')} title={k}>{k}</Link>
            ))}
          </div>
        )}
        <Link href="/settings/ai" className="ml-auto text-xs text-primary underline-offset-4 hover:underline">Keys and routing →</Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Cost" value={t.cost.priced === 0 ? '—' : fmtUsd(t.cost.usd)} sub={t.cost.unpriced > 0 ? `${t.cost.unpriced} unpriced ${t.cost.unpriced === 1 ? 'call' : 'calls'}` : 'USD, list prices'} />
        <Tile label="API requests" value={fmtInt(t.calls)} sub={t.failures > 0 ? `${t.failures} failed` : 'none failed'} />
        <Tile label="Tokens" value={fmtInt(t.tokens)} sub={`${fmtInt(t.inputTokens)} in · ${fmtInt(t.outputTokens)} out`} />
        <Tile label="Latency" value={t.latencyMs === null ? '—' : `${(t.latencyMs / 1000).toFixed(1)}s`} sub="mean, successful calls" />
      </div>

      {t.calls === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No AI calls in the last {windowDays} days{dash.key ? ` on ${dash.key}` : ''}. Grading an answer, generating a quiz, playing Hot Seat or running a diagnostic will show up here.
        </div>
      ) : (
        <>
          {(t.reasoningTokens > 0 || t.cachedTokens > 0) && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t.reasoningTokens > 0 && <>{fmtInt(t.reasoningTokens)} of the output tokens were reasoning — providers bill thinking as output, so it is counted once, inside the output figure.</>}
              {t.cachedTokens > 0 && <> {fmtInt(t.cachedTokens)} input tokens were served from the provider&rsquo;s cache.</>}
            </p>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <DailyBars days={dash.days} models={dash.byModel} tasks={dash.byTask} totalCost={t.cost.usd} totalCalls={t.calls} totalTokens={t.tokens} />
            <TaskPie tasks={dash.byTask} />
          </div>

          <h2 className="label mt-8 mb-3">By model</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {dash.byModel.map((m, i) => (
              <div key={m.key} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="inline-flex items-center gap-2 font-mono text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colourFor(i) }} aria-hidden="true" />{m.key}</div>
                  <span className="text-xs text-muted-foreground">{Math.round(m.share * 100)}% of tokens</span>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Requests</dt><dd className="metric font-semibold">{fmtInt(m.calls)}{m.failures > 0 && <span className="ml-1 text-xs font-normal text-destructive">{m.failures} failed</span>}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Tokens</dt><dd className="metric font-semibold">{fmtInt(m.tokens)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Cost</dt><dd className="metric font-semibold">{m.cost.priced === 0 ? <span className="text-muted-foreground" title="No rate table for this model">unpriced</span> : fmtUsd(m.cost.usd)}</dd></div>
                </dl>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-muted-foreground">Requests per day</div>
                    <Sparkline values={dash.days.map((d) => d.byModel[m.key]?.calls ?? 0)} label={`${m.key} requests per day`} colour={colourFor(i)} />
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Tokens per day</div>
                    <Sparkline values={dash.days.map((d) => d.byModel[m.key]?.tokens ?? 0)} label={`${m.key} tokens per day`} colour={colourFor(i)} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <HistoryTable rows={dash.history} windowDays={windowDays} />
          </div>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="metric mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  )
}
