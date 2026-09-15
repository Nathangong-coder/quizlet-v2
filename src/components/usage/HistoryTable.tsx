'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { historyCsv, type HistoryRow } from '@/lib/ai/usage-dashboard'
import { fmtInt } from './charts'

const PAGE = 25

/**
 * Every call in the window, newest first, each one LABELLED — the task by
 * its human name, the model, the key it ran on, the outcome, the tokens and
 * what it cost. Filter by task or outcome; page through; export the whole
 * window as CSV (built in the browser from the same rows).
 */
export function HistoryTable({ rows, windowDays }: { rows: HistoryRow[]; windowDays: number }) {
  const [task, setTask] = useState<string>('all')
  const [outcome, setOutcome] = useState<'all' | 'ok' | 'failed'>('all')
  const [page, setPage] = useState(0)
  const tasks = useMemo(() => [...new Map(rows.map((r) => [r.task, r.taskLabel])).entries()], [rows])
  const shown = useMemo(
    () => rows.filter((r) => (task === 'all' || r.task === task) && (outcome === 'all' || (outcome === 'ok') === r.ok)),
    [rows, task, outcome],
  )
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const slice = shown.slice(page * PAGE, page * PAGE + PAGE)

  function exportCsv() {
    const blob = new Blob([historyCsv(shown)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-usage-${windowDays}d.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Call history</div>
          <p className="text-xs text-muted-foreground">{shown.length} of {rows.length} calls in the last {windowDays} days.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={task} onChange={(e) => { setTask(e.target.value); setPage(0) }} aria-label="Filter by task" className="rounded-md border border-border bg-transparent px-2 py-1">
            <option value="all">All tasks</option>
            {tasks.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <select value={outcome} onChange={(e) => { setOutcome(e.target.value as typeof outcome); setPage(0) }} aria-label="Filter by outcome" className="rounded-md border border-border bg-transparent px-2 py-1">
            <option value="all">All outcomes</option>
            <option value="ok">Succeeded</option>
            <option value="failed">Failed</option>
          </select>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={shown.length === 0}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">When</th>
              <th scope="col" className="py-2 pr-3 font-medium">Task</th>
              <th scope="col" className="py-2 pr-3 font-medium">Model</th>
              <th scope="col" className="py-2 pr-3 font-medium">Key</th>
              <th scope="col" className="py-2 pr-3 font-medium">Outcome</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">In</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Out</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Latency</th>
              <th scope="col" className="py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-muted-foreground">{new Date(r.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="py-2 pr-3">{r.taskLabel}</td>
                <td className="py-2 pr-3 font-mono text-xs">{r.model}</td>
                <td className="max-w-32 truncate py-2 pr-3 text-xs text-muted-foreground" title={r.key}>{r.key}</td>
                <td className="py-2 pr-3">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', r.ok ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive')} title={r.failureKind ?? undefined}>
                    {r.ok ? 'ok' : r.failureKind ?? 'failed'}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{r.inputTokens === null ? '—' : fmtInt(r.inputTokens)}</td>
                <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums" title={r.reasoningTokens ? `${fmtInt(r.reasoningTokens)} reasoning` : undefined}>{r.outputTokens === null ? '—' : fmtInt(r.outputTokens)}</td>
                <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{(r.latencyMs / 1000).toFixed(1)}s</td>
                <td className="py-2 text-right font-mono text-xs tabular-nums">{r.cost === null ? <span className="text-muted-foreground" title="No rate table for this model">unpriced</span> : r.cost < 0.0005 ? '<$0.001' : `$${r.cost.toFixed(3)}`}</td>
              </tr>
            ))}
            {slice.length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">No calls match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page + 1} of {pages}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
            <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}
