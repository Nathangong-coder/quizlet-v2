/**
 * Broken-link crawl over a running server, signed out.
 *
 *   npx tsx scripts/crawl-links.ts http://localhost:3000
 *
 * Follows every same-origin <a href> from `/`, records the final status of
 * each page, and reports anything ≥ 400. A redirect to /login is a pass
 * (that is the app working). Bare-route study pages that need an id are
 * only reached through real links, so a stale deep link shows up as a 404
 * here rather than in a user's bookmark.
 */
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '')
const MAX = 400
const seen = new Set<string>()
const queue: string[] = ['/']
const bad: { path: string; status: number; from: string }[] = []
const from = new Map<string, string>()

function extract(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/href="([^"#]+)(#[^"]*)?"/g)) {
    const href = m[1]
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue
    if (/^https?:\/\//.test(href)) { if (!href.startsWith(base)) continue; out.push(href.slice(base.length)); continue }
    if (href.startsWith('/')) out.push(href)
  }
  return out
}

async function main() {
  while (queue.length && seen.size < MAX) {
    const path = queue.shift()!
    if (seen.has(path)) continue
    seen.add(path)
    let res: Response
    try {
      res = await fetch(base + path, { redirect: 'follow', headers: { accept: 'text/html' } })
    } catch {
      bad.push({ path, status: 0, from: from.get(path) ?? '-' })
      continue
    }
    if (res.status >= 400) bad.push({ path, status: res.status, from: from.get(path) ?? '-' })
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('text/html')) continue
    // Do not crawl past the sign-in wall: a redirected page's links are the login page's links.
    if (new URL(res.url).pathname === '/login' && path !== '/login') continue
    const html = await res.text()
    for (const next of extract(html)) {
      const clean = next.split('?')[0] === '' ? '/' : next
      if (!seen.has(clean) && !queue.includes(clean)) { queue.push(clean); from.set(clean, path) }
    }
  }
  console.log(`crawled ${seen.size} pages from ${base}`)
  for (const b of bad) console.log(`  ${b.status || 'ERR'}  ${b.path}   (linked from ${b.from})`)
  console.log(bad.length === 0 ? 'no broken links' : `${bad.length} broken link(s)`)
  process.exit(bad.length === 0 ? 0 : 1)
}
main()
