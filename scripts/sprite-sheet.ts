/**
 * Writes a static HTML sprite sheet of every game character, for eyeballing.
 *   npx tsx scripts/sprite-sheet.ts > sheet.html
 */
import { PALETTE, compose, KNIGHT, KNIGHT_SHIELD, SLIME, IMP, DARK_KNIGHT, BOSS, MAGICIAN, HOST_BASE, FACES, COSTUMES, type Sprite } from '../src/lib/games/sprites'

function svg(rows: string[], size: number): string {
  const h = rows.length
  const w = Math.max(...rows.map((r) => r.length))
  const rects: string[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      if (ch === '.' || ch === ' ') { x++; continue }
      let len = 1
      while (x + len < row.length && row[x + len] === ch) len++
      rects.push(`<rect x="${x}" y="${y}" width="${len}" height="1" fill="${PALETTE[ch] ?? '#ff00ff'}"/>`)
      x += len
    }
  })
  return `<svg viewBox="0 0 ${w} ${h}" width="${size}" height="${(size * h) / w}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}

const cell = (name: string, rows: string[]) => `<figure style="margin:0;text-align:center"><div style="background:#1a1a2e;padding:8px;border-radius:8px;display:inline-block">${svg(rows, 144)}</div><figcaption style="font:12px sans-serif;color:#ccc">${name}</figcaption></figure>`
const cast: [string, string[]][] = [
  ['knight', compose(KNIGHT, KNIGHT_SHIELD)],
  ['slime', compose(SLIME)],
  ['imp', compose(IMP)],
  ['dark knight', compose(DARK_KNIGHT)],
  ['boss', compose(BOSS)],
  ['magician', compose(MAGICIAN)],
]
for (const face of Object.keys(FACES) as (keyof typeof FACES)[]) cast.push([`host · ${face}`, compose(HOST_BASE, FACES[face] as Sprite)])
for (const c of Object.values(COSTUMES)) cast.push([`host · ${c.name}`, compose(HOST_BASE, FACES.neutral as Sprite, c.overlay)])

console.log(`<!doctype html><meta charset="utf-8"><body style="background:#0f1020;padding:20px;display:grid;grid-template-columns:repeat(6,1fr);gap:16px">${cast.map(([n, r]) => cell(n, r)).join('')}</body>`)
