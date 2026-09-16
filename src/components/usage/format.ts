/**
 * Formatting shared by the usage page (a server component) and its charts
 * (client components). Deliberately NOT a 'use client' module: a helper
 * exported from a client file cannot be CALLED on the server — Next turns
 * it into a reference, and the first server render throws
 * "Attempted to call fmtUsd() from the server but fmtUsd is on the client"
 * (found on Vercel, 2026-09-14).
 */

export const SERIES_COLOURS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', '#7c3aed', '#0f766e', '#e0b25a', '#c8323f']

export function colourFor(index: number): string {
  return SERIES_COLOURS[index % SERIES_COLOURS.length]
}

export function fmtInt(n: number): string {
  return n.toLocaleString()
}

export function fmtUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}
