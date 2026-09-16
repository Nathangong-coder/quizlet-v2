// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { shapeDashboard, historyCsv, windowDays, parseWindow, type DashboardRow } from '@/lib/ai/usage-dashboard'
import { DailyBars, TaskPie } from '@/components/usage/charts'
import { HistoryTable } from '@/components/usage/HistoryTable'

afterEach(cleanup)

const NOW = new Date('2026-09-14T12:00:00Z')
const at = (daysAgo: number, h = 10) => new Date(NOW.getTime() - daysAgo * 86_400_000 + (h - 12) * 3_600_000)
const row = (p: Partial<DashboardRow> & { id: string }): DashboardRow => ({
  createdAt: at(0),
  task: 'grade',
  model: 'deepseek-v4-flash',
  provider: 'deepseek',
  credentialLabel: 'Personal',
  ok: true,
  failureKind: null,
  latencyMs: 2000,
  inputTokens: 1000,
  outputTokens: 500,
  reasoningTokens: 200,
  cachedTokens: 0,
  ...p,
})

const rows: DashboardRow[] = [
  row({ id: 'a', createdAt: at(0) }),
  row({ id: 'b', createdAt: at(1), task: 'distractors', model: 'gemini-3.6-flash', provider: 'google', credentialLabel: 'Shared', inputTokens: 3000, outputTokens: 1000, reasoningTokens: 0 }),
  row({ id: 'c', createdAt: at(1), ok: false, failureKind: 'quota_exhausted', inputTokens: null, outputTokens: null, reasoningTokens: null, latencyMs: 9000 }),
  row({ id: 'd', createdAt: at(40), task: 'diagnostic' }), // outside a 30-day window: dropped everywhere
]

describe('usage dashboard shaping', () => {
  it('totals, buckets with shares, a zero-filled day series, and labelled history newest first', () => {
    const d = shapeDashboard({ rows, windowDays: 30, key: null, now: NOW })
    expect(d.keys).toEqual(['Personal', 'Shared'])
    expect(d.totals.calls).toBe(3)
    expect(d.totals.failures).toBe(1)
    expect(d.totals.tokens).toBe(1500 + 4000 + 0)
    expect(d.totals.reasoningTokens).toBe(200)
    // Mean latency over SUCCESSFUL calls only.
    expect(d.totals.latencyMs).toBe(2000)
    // deepseek is priced, google is not, and a failed call with no usage is unpriced too.
    expect(d.totals.cost.priced).toBe(1)
    expect(d.totals.cost.unpriced).toBe(2)
    expect(d.byTask.map((b) => [b.key, b.label, b.calls])).toEqual([
      ['distractors', 'Multiple-choice distractors', 1],
      ['grade', 'Grading (short-answer & spoken)', 2],
    ])
    expect(d.byTask.reduce((n, b) => n + b.share, 0)).toBeCloseTo(1)
    expect(d.byModel[0].key).toBe('gemini-3.6-flash')
    expect(d.byModel[1].failures).toBe(1)
    // Thirty days, oldest first, every day present; today's and yesterday's calls land on their days.
    expect(d.days).toHaveLength(30)
    expect(d.days[29].day).toBe('2026-09-14')
    expect(d.days[29].calls).toBe(1)
    expect(d.days[28].calls).toBe(2)
    expect(d.days[28].byModel['gemini-3.6-flash'].tokens).toBe(4000)
    expect(d.days[28].byTask['grade'].calls).toBe(1)
    expect(d.days.reduce((n, x) => n + x.calls, 0)).toBe(3)
    expect(d.history.map((h) => h.id)).toEqual(['a', 'b', 'c'])
    expect(d.history[2]).toMatchObject({ ok: false, failureKind: 'quota_exhausted', cost: null, taskLabel: 'Grading (short-answer & spoken)' })
    expect(d.history[0].cost).toBeGreaterThan(0)
  })

  it('filters by key, and parses the window', () => {
    const d = shapeDashboard({ rows, windowDays: 7, key: 'Shared', now: NOW })
    expect(d.totals.calls).toBe(1)
    expect(d.keys).toEqual(['Personal', 'Shared']) // keys are listed from the whole window so the filter can be undone
    expect(d.days).toHaveLength(7)
    expect(parseWindow('7')).toBe(7)
    expect(parseWindow('90')).toBe(90)
    expect(parseWindow('12')).toBe(30)
    expect(parseWindow(undefined)).toBe(30)
    expect(windowDays(NOW, 3)).toEqual(['2026-09-12', '2026-09-13', '2026-09-14'])
  })

  it('exports a CSV with a header and escaped fields', () => {
    const d = shapeDashboard({ rows: [row({ id: 'x', credentialLabel: 'Key, "main"' })], windowDays: 7, key: null, now: NOW })
    const csv = historyCsv(d.history)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('time,task,model,provider,key,ok,failure,latency_ms,input_tokens,output_tokens,reasoning_tokens,cached_tokens,cost_usd')
    expect(lines[1]).toContain('"Key, ""main"""')
    expect(lines[1]).toContain(',ok,,2000,1000,500,200,0,')
  })
})

describe('usage dashboard components', () => {
  const d = shapeDashboard({ rows, windowDays: 7, key: null, now: NOW })

  it('draws the daily bars and switches split and metric', () => {
    render(<DailyBars days={d.days} models={d.byModel} tasks={d.byTask} totalCost={d.totals.cost.usd} totalCalls={d.totals.calls} totalTokens={d.totals.tokens} />)
    expect(screen.getByRole('img', { name: /cost \(usd\) per day, split by model/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /task/i }))
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: 'tokens' } })
    expect(screen.getByRole('img', { name: /tokens per day, split by task/i })).toBeTruthy()
    expect(screen.getByText('Multiple-choice distractors')).toBeTruthy()
  })

  it('draws the pie with one slice per task', () => {
    const { container } = render(<TaskPie tasks={d.byTask} />)
    expect(container.querySelectorAll('path')).toHaveLength(d.byTask.length)
    expect(screen.getAllByText(/grading \(short-answer & spoken\)/i).length).toBeGreaterThan(0)
  })

  it('lists every call labelled, and filters by outcome', () => {
    render(<HistoryTable rows={d.history} windowDays={7} />)
    expect(screen.getAllByRole('row')).toHaveLength(1 + 3)
    expect(screen.getByText('quota_exhausted')).toBeTruthy()
    // Two table cells (the filter's <option> carries the label too).
    expect(screen.getAllByRole('cell', { name: 'Grading (short-answer & spoken)' })).toHaveLength(2)
    fireEvent.change(screen.getByLabelText(/filter by outcome/i), { target: { value: 'failed' } })
    expect(screen.getAllByRole('row')).toHaveLength(1 + 1)
    fireEvent.change(screen.getByLabelText(/filter by task/i), { target: { value: 'distractors' } })
    expect(screen.getByText(/no calls match/i)).toBeTruthy()
  })
})
