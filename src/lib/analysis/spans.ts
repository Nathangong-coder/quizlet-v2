export interface Span { start: number; end: number }

/**
 * Quote → [start, end] over the stored answer. The MODEL quotes; TypeScript
 * locates. Models count characters badly, so an offset from the model would
 * poison every metric built on coverage; an exact-or-normalised text match
 * cannot be off by one.
 *
 * Exact first. Then a normalised pass (case-folded, straight quotes, runs of
 * whitespace collapsed) mapped back to original offsets. Then null — which
 * means the model paraphrased instead of quoting, and the caller records
 * `quote_unresolved`; that rate is a grader-quality number the benchmark reports.
 */
export function resolveSpan(answer: string, quote: string): Span | null {
  if (!quote.trim()) return null
  const exact = answer.indexOf(quote)
  if (exact >= 0) return { start: exact, end: exact + quote.length }
  const { text, map } = normalise(answer)
  const q = normalise(quote).text
  if (!q) return null
  const at = text.indexOf(q)
  if (at < 0) return null
  return { start: map[at], end: map[at + q.length - 1] + 1 }
}

/** Lower-cased, quotes straightened, whitespace runs → one space; `map[i]` is the original index of normalised char i. */
function normalise(s: string): { text: string; map: number[] } {
  const out: string[] = []; const map: number[] = []
  let pendingSpace = false
  for (let i = 0; i < s.length; i++) {
    let c = s[i].toLowerCase()
    if (c === '‘' || c === '’') c = "'"
    if (c === '“' || c === '”') c = '"'
    if (/\s/.test(c)) { pendingSpace = out.length > 0; continue }
    if (pendingSpace) { out.push(' '); map.push(i - 1); pendingSpace = false }
    out.push(c); map.push(i)
  }
  return { text: out.join(''), map }
}

/** Fraction of `length` covered by the union of spans. */
export function unionCoverage(spans: Span[], length: number): number {
  if (length <= 0) return 0
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)
  let covered = 0; let curStart = -1; let curEnd = -1
  for (const s of sorted) {
    if (s.start > curEnd) { if (curEnd > curStart) covered += curEnd - curStart; curStart = s.start; curEnd = s.end }
    else curEnd = Math.max(curEnd, s.end)
  }
  if (curEnd > curStart) covered += curEnd - curStart
  return Math.min(1, covered / length)
}
