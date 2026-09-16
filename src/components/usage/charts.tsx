'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { DayPoint, Bucket } from '@/lib/ai/usage-dashboard'

/**
 * The dashboard's charts, hand-drawn SVG — no chart library, so the page
 * ships nothing it does not use and every colour is a theme token.
 * A series colour is assigned by rank (biggest first) so the legend, the
 * bars and the pie agree.
 */

import { SERIES_COLOURS, colourFor, fmtInt, fmtUsd, fmtCompact } from './format'

export { SERIES_COLOURS, colourFor, fmtInt, fmtUsd, fmtCompact }

type Metric = 'cost' | 'calls' | 'tokens'
type Split = 'model' | 'task'

const METRIC_LABEL: Record<Metric, string> = { cost: 'Cost (USD)', calls: 'API requests', tokens: 'Tokens' }

/**
 * Daily stacked bars. The split (model / task) and the metric are toggles;
 * the series order comes from the buckets so colours match the legend.
 */
export function DailyBars({ days, models, tasks, totalCost, totalCalls, totalTokens }: { days: DayPoint[]; models: Bucket[]; tasks: Bucket[]; totalCost: number; totalCalls: number; totalTokens: number }) {
  const [metric, setMetric] = useState<Metric>('cost')
  const [split, setSplit] = useState<Split>('model')
  const series = split === 'model' ? models : tasks
  const W = 720
  const H = 220
  const padL = 44
  const padB = 24
  const padT = 8
  const innerW = W - padL - 8
  const innerH = H - padB - padT
  const value = (d: DayPoint, key?: string) => {
    const rec = key ? (split === 'model' ? d.byModel[key] : d.byTask[key]) : d
    if (!rec) return 0
    return metric === 'cost' ? rec.cost : metric === 'calls' ? rec.calls : rec.tokens
  }
  const max = Math.max(...days.map((d) => value(d)), metric === 'cost' ? 0.01 : 1)
  const slot = innerW / days.length
  const bw = Math.max(2, Math.min(18, slot * 0.7))
  const fmtY = (v: number) => (metric === 'cost' ? (v < 1 ? v.toFixed(2) : v.toFixed(1)) : fmtCompact(Math.round(v)))
  const ticks = [0, 0.5, 1].map((t) => t * max)
  const labelEvery = Math.max(1, Math.ceil(days.length / 6))
  const total = metric === 'cost' ? fmtUsd(totalCost) : metric === 'calls' ? fmtInt(totalCalls) : fmtInt(totalTokens)

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} aria-label="Metric" className="rounded-md border border-border bg-transparent px-2 py-1 text-sm font-semibold">
            {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
          </select>
          <span className="font-mono text-sm text-muted-foreground">{total}</span>
        </div>
        <div className="inline-flex rounded-full border border-border p-0.5 text-xs" role="radiogroup" aria-label="Split by">
          {(['model', 'task'] as Split[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={split === s} onClick={() => setSplit(s)} className={cn('rounded-full px-3 py-1 capitalize', split === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{s}</button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label={`${METRIC_LABEL[metric]} per day, split by ${split}`}>
        {ticks.map((t, i) => {
          const y = padT + innerH - (t / max) * innerH
          return (
            <g key={i}>
              <line x1={padL} x2={W - 8} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.12} />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.6}>{fmtY(t)}</text>
            </g>
          )
        })}
        {days.map((d, i) => {
          const x = padL + i * slot + (slot - bw) / 2
          let yTop = padT + innerH
          const dayTotal = value(d)
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${metric === 'cost' ? fmtUsd(dayTotal) : fmtInt(dayTotal)}`}</title>
              {series.map((s, si) => {
                const v = value(d, s.key)
                if (v <= 0) return null
                const h = (v / max) * innerH
                yTop -= h
                return <rect key={s.key} x={x} y={yTop} width={bw} height={h} fill={colourFor(si)} rx={1.5} />
              })}
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.6}>{d.day.slice(5).replace('-', '/')}</text>
              )}
            </g>
          )
        })}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.slice(0, 9).map((s, i) => (
          <li key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colourFor(i) }} aria-hidden="true" />{s.label}</li>
        ))}
      </ul>
    </div>
  )
}

/** Share by task, as a donut with a legend. */
export function TaskPie({ tasks }: { tasks: Bucket[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const R = 70
  const r = 42
  const C = 80
  // Cumulative angles, computed up front (the compiler forbids mutating a
  // closed-over variable inside the map).
  const starts = tasks.reduce<number[]>((acc, t, i) => { acc.push(i === 0 ? -Math.PI / 2 : acc[i - 1] + tasks[i - 1].share * Math.PI * 2); return acc }, [])
  const slices = tasks.map((t, i) => {
    const a0 = starts[i]
    const a1 = a0 + t.share * Math.PI * 2
    const big = a1 - a0 > Math.PI ? 1 : 0
    const p = (ang: number, rad: number) => `${(C + rad * Math.cos(ang)).toFixed(2)} ${(C + rad * Math.sin(ang)).toFixed(2)}`
    const d = t.share >= 0.9999
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`
      : `M ${p(a0, R)} A ${R} ${R} 0 ${big} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${big} 0 ${p(a0, r)} Z`
    return { ...t, d, colour: colourFor(i) }
  })
  const shown = hover ? slices.find((s) => s.key === hover) : null

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="font-semibold">By task</div>
      <p className="text-xs text-muted-foreground">Share of tokens in the window.</p>
      {tasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-5">
          <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0" role="img" aria-label="Tokens by task">
            {slices.map((s) => (
              <path key={s.key} d={s.d} fill={s.colour} opacity={hover && hover !== s.key ? 0.35 : 1} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}>
                <title>{`${s.label}: ${Math.round(s.share * 100)}% · ${fmtInt(s.tokens)} tokens · ${s.calls} calls`}</title>
              </path>
            ))}
            <text x={C} y={C - 4} textAnchor="middle" fontSize={16} fontWeight={700} fill="currentColor">{shown ? `${Math.round(shown.share * 100)}%` : `${tasks.length}`}</text>
            <text x={C} y={C + 12} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>{shown ? shown.label.slice(0, 22) : tasks.length === 1 ? 'task' : 'tasks'}</text>
          </svg>
          <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center gap-2" onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.colour }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{Math.round(s.share * 100)}% · {s.calls} {s.calls === 1 ? 'call' : 'calls'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * A small filled line for one model's requests or tokens per day. Takes the
 * NUMBERS, not a picker: the page is a server component and a function
 * cannot cross into a client component as a prop.
 */
export function Sparkline({ values, label, colour }: { values: number[]; label: string; colour: string }) {
  const W = 300
  const H = 80
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? W / (values.length - 1) : W
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(H - (v / max) * (H - 6) - 3).toFixed(1)}`)
  const path = `M ${pts.join(' L ')}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" role="img" aria-label={label}>
      <path d={`${path} L ${W} ${H} L 0 ${H} Z`} fill={colour} opacity={0.18} />
      <path d={path} fill="none" stroke={colour} strokeWidth={1.5} />
    </svg>
  )
}
