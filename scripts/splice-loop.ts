/**
 * Splice a subset re-mint over a full loop file (2026-09-15): outcomes in
 * `patch` replace the same cards in `base`; everything else is kept.
 *
 *   npx tsx scripts/splice-loop.ts base.json patch.json out.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
const [base, patch, out] = process.argv.slice(2)
const b = JSON.parse(readFileSync(base, 'utf8')) as { outcomes: { cardId: string }[]; failures?: { cardId: string }[] }
const p = JSON.parse(readFileSync(patch, 'utf8')) as { outcomes: { cardId: string }[]; failures?: { cardId: string }[] }
const replaced = new Set(p.outcomes.map((o) => o.cardId))
b.outcomes = [...b.outcomes.filter((o) => !replaced.has(o.cardId)), ...p.outcomes]
if (b.failures) b.failures = b.failures.filter((f) => !replaced.has(f.cardId))
writeFileSync(out, JSON.stringify(b, null, 2))
console.log(`[splice] ${replaced.size} cards replaced; ${b.outcomes.length} outcomes in ${out}`)
