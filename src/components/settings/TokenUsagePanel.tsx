import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { loadUsageSummary, type UsageBucket } from '@/lib/ai/usage'
import { AI_TASK_LABELS } from '@/lib/ai/model-routing'

/** `1,234` — plain, monospaced, no rounding. A token count is exact; say it. */
function n(value: number): string {
  return value.toLocaleString()
}

/**
 * Priced dollars beside the count of calls we could not price.
 *
 * Never a bare `$0.00`: most calls here run on Google, which publishes no rate
 * table this app carries, so a lone zero would read as "you spent nothing"
 * when it means "nothing is known".
 */
function cost(bucket: { usd: number; priced: number; unpriced: number }): string {
  if (bucket.priced === 0) return '—'
  const usd = bucket.usd < 0.01 && bucket.usd > 0 ? '<$0.01' : `$${bucket.usd.toFixed(2)}`
  return bucket.unpriced === 0 ? usd : `${usd} + ${bucket.unpriced} unpriced`
}

function Breakdown({ title, rows }: { title: string; rows: UsageBucket[] }) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="divide-y divide-border">
        {rows.slice(0, 8).map((row) => (
          <li key={row.key} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <span className="truncate font-medium">
              {AI_TASK_LABELS[row.key as keyof typeof AI_TASK_LABELS] ?? row.key}
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {n(row.inputTokens + row.outputTokens)} tok · {row.calls} call
              {row.calls === 1 ? '' : 's'} · {cost(row.cost)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The learner's own AI usage. Every user has one; it is not an admin view.
 *
 * Read from `AiCallLog` on each render rather than cached — see `lib/ai/usage`
 * for why there is no second counter.
 */
export default async function TokenUsagePanel() {
  const session = await auth()
  if (!session?.user?.id) return null

  const usage = await loadUsageSummary(prisma, session.user.id)

  if (usage.calls === 0) {
    return (
      <section className="space-y-2 rounded-lg border border-border p-5">
        <h2 className="font-semibold">Your AI usage</h2>
        <p className="text-sm text-muted-foreground">
          No AI calls in the last {usage.windowDays} days. Grading an answer, generating a quiz or
          running the diagnostic will show up here.
        </p>
      </section>
    )
  }

  const total = usage.inputTokens + usage.outputTokens

  return (
    <section className="space-y-5 rounded-lg border border-border p-5">
      <div>
        <h2 className="font-semibold">Your AI usage</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Last {usage.windowDays} days, across every key you used.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['Tokens', n(total)],
          ['Calls', n(usage.calls)],
          ['Failed', n(usage.failures)],
          ['Cost', cost(usage.cost)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="font-mono text-lg tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs leading-5 text-muted-foreground">
        {n(usage.inputTokens)} in · {n(usage.outputTokens)} out
        {usage.reasoningTokens > 0 && (
          <>
            {' '}
            (of which {n(usage.reasoningTokens)} reasoning — providers bill thinking as output, so
            it is counted once, inside the output figure)
          </>
        )}
        {usage.cachedTokens > 0 && <> · {n(usage.cachedTokens)} input tokens served from cache</>}
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <Breakdown title="By task" rows={usage.byTask} />
        <Breakdown title="By model" rows={usage.byModel} />
      </div>
    </section>
  )
}
