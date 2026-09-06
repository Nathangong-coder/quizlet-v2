import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/staff/access'
import { loadAiTaskHistory, loadAiTaskCounts, loadAuthoringByModel } from '@/lib/staff/queries'
import { AI_TASKS } from '@/lib/ai/model-routing'
import { StaffNav } from '../StaffNav'

/**
 * AI task history — which model did what, so performance can be benchmarked.
 *
 * ADMIN ONLY, not staff. The rows name every user whose key served a call and
 * how their credentials behaved; that is operator data, not teaching data.
 *
 * One sub-tab per task, because a model that is excellent at autocomplete and
 * hopeless at authoring is the normal case, and a single blended table would
 * average exactly the difference worth seeing. The pilot's evidence:
 * gemini-2.5-flash returned usable text for simple calls and could not satisfy
 * the authoring schema at all.
 */
export default async function StaffAiHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>
}) {
  const admin = await requireAdmin()
  if (!admin) notFound()

  const params = await searchParams
  const task = AI_TASKS.includes(params.task as (typeof AI_TASKS)[number])
    ? (params.task as string)
    : AI_TASKS[0]

  const [history, counts, authoring] = await Promise.all([
    loadAiTaskHistory(task),
    loadAiTaskCounts(),
    loadAuthoringByModel(),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">AI task history</h1>
      <StaffNav isAdmin />

      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        One row per <strong>attempt</strong>, not per request. A single call rotates through
        credentials when one fails, so one grading request can touch three models &mdash; logging
        only the winner would hide which models fail and how often, which is the thing worth
        measuring. Latency medians cover <strong>successful</strong> calls only: a failure&rsquo;s
        latency measures how long the provider took to say no.
      </p>

      <nav aria-label="AI tasks" className="border-b">
        <ul className="-mb-px flex flex-wrap gap-1">
          {AI_TASKS.map((t) => (
            <li key={t}>
              <Link
                href={`/staff/ai-history?task=${t}`}
                aria-current={t === task ? 'page' : undefined}
                className={`inline-block border-b-2 px-3 py-2 text-sm ${
                  t === task
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                }`}
              >
                {t}
                <span className="ml-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {counts[t] ?? 0}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {history.totalCalls === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          No calls recorded for <code>{task}</code> yet. Logging began when this page shipped, so
          anything generated before that is not here &mdash; the rows are not missing, they were
          never written.
        </p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-medium">By model</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left align-bottom text-muted-foreground">
                    <th className="pb-2 font-normal">Model</th>
                    <th className="pb-2 font-normal">Provider</th>
                    <th className="pb-2 text-right font-normal">Calls</th>
                    <th className="pb-2 text-right font-normal">Failed</th>
                    <th className="pb-2 text-right font-normal">Median latency</th>
                    <th className="pb-2 text-right font-normal">Output tokens</th>
                    <th className="pb-2 text-right font-normal">Est. cost</th>
                    <th className="pb-2 font-normal">Failure kinds</th>
                    <th className="pb-2 font-normal">Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {history.byModel.map((m) => (
                    <tr key={m.model} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{m.model}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{m.provider}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">{m.calls}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {m.failures === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">{m.failures}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {/* Null is NO SUCCESSFUL CALL, not an instant one. */}
                        {m.medianLatencyMs === null ? '—' : `${(m.medianLatencyMs / 1000).toFixed(1)}s`}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {m.outputTokens === 0 ? (
                          <span className="text-muted-foreground">&mdash;</span>
                        ) : (
                          <>
                            {m.outputTokens.toLocaleString()}
                            {m.reasoningTokens > 0 && (
                              <span
                                className="ml-1 text-[11px] text-muted-foreground"
                                title="Reasoning tokens, already included in the output total. Normally the majority, and invisible in the text."
                              >
                                ({Math.round((m.reasoningTokens / m.outputTokens) * 100)}% reasoning)
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {/*
                          An em dash means NO RATE IS CONFIGURED, not $0. Showing
                          zero would read as "this was free", which is the one
                          thing a cost column must never imply — see
                          src/lib/ai/pricing.ts.
                        */}
                        {m.cost.priced === 0 ? (
                          <span
                            className="text-muted-foreground"
                            title={`No price configured for ${m.model}. Add it to MODEL_RATES in src/lib/ai/pricing.ts.`}
                          >
                            &mdash;
                          </span>
                        ) : (
                          <>
                            ${m.cost.usd.toFixed(4)}
                            {m.cost.unpriced > 0 && (
                              <span
                                className="ml-1 text-[11px] text-amber-600 dark:text-amber-400"
                                title={`${m.cost.unpriced} call(s) had no configured rate and are NOT in this total.`}
                              >
                                +{m.cost.unpriced} unpriced
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {Object.keys(m.failureKinds).length === 0
                          ? '—'
                          : Object.entries(m.failureKinds)
                              .map(([kind, n]) => `${kind} ×${n}`)
                              .join(', ')}
                      </td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {m.lastUsedAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Recent attempts</h2>
            <ul className="divide-y rounded-lg border text-sm">
              {history.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span
                    className={`w-16 shrink-0 font-mono text-[11px] ${
                      r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {r.ok ? 'ok' : 'failed'}
                  </span>
                  <span className="font-mono text-xs">{r.model}</span>
                  <span className="text-xs text-muted-foreground">{r.credentialLabel}</span>
                  {r.failureKind && (
                    <span className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground">
                      {r.failureKind}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                    {(r.latencyMs / 1000).toFixed(1)}s
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">{r.userLabel}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {/* The other half of the benchmark: AiCallLog says which model was CALLED,
          CardAuthoring.model says which one produced an artifact still in the
          corpus — and separation scores that artifact's quality. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Key points authored, by model</h2>
        <p className="max-w-prose text-xs text-muted-foreground">
          Separation is how far the correct answer outscored the best deliberately-wrong one on the
          cards a model authored. Higher is better; below 0.40 is flagged low discrimination.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left align-bottom text-muted-foreground">
                <th className="pb-2 font-normal">Model</th>
                <th className="pb-2 text-right font-normal">Cards</th>
                <th className="pb-2 text-right font-normal">Mean separation</th>
                <th className="pb-2 text-right font-normal">Low discrimination</th>
              </tr>
            </thead>
            <tbody>
              {authoring.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-sm text-muted-foreground">
                    No cards have been through the authoring pipeline yet.
                  </td>
                </tr>
              ) : (
                authoring.map((a) => (
                  <tr key={a.model} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {a.model}
                      {a.model === 'not recorded' && (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          authored before the model column existed
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">{a.cards}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">
                      {a.meanSeparation === null ? '—' : a.meanSeparation.toFixed(2)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">{a.lowDiscrimination}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
