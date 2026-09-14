/**
 * First-load client JS per route, from the last `next experimental-analyze`
 * (or `next build`) run's `.next/diagnostics/route-bundle-stats.json`.
 *
 *   npx tsx scripts/route-bytes.ts            # every route, smallest first
 *   npx tsx scripts/route-bytes.ts /          # one route, with its chunks
 *
 * The number is what a cold visitor downloads before the page is
 * interactive; it is the thing to watch when a "small" client import lands
 * on a public page.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface RouteStat {
  route: string
  firstLoadUncompressedJsBytes: number
  firstLoadChunkPaths: string[]
}

const stats = Object.values(JSON.parse(readFileSync(join(process.cwd(), '.next/diagnostics/route-bundle-stats.json'), 'utf8')) as Record<string, RouteStat>)
const only = process.argv[2]

if (only) {
  const r = stats.find((s) => s.route === only)
  if (!r) { console.error(`no route ${only}`); process.exit(1) }
  console.log(`${only}: ${Math.round(r.firstLoadUncompressedJsBytes / 1024)} KiB first-load JS in ${r.firstLoadChunkPaths.length} chunks`)
  for (const p of r.firstLoadChunkPaths) console.log('  ', p.split(/[\\/]/).pop())
} else {
  for (const r of [...stats].sort((a, b) => a.firstLoadUncompressedJsBytes - b.firstLoadUncompressedJsBytes)) {
    console.log(String(Math.round(r.firstLoadUncompressedJsBytes / 1024)).padStart(6), 'KiB', r.route)
  }
}
