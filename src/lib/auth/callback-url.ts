/**
 * Restrict a `?callbackUrl=` query value to a same-origin relative path.
 *
 * Round one: a naive `raw.startsWith('/') && !raw.startsWith('//')` string
 * check inspected the RAW string, but the sinks that actually consume this
 * value (next/navigation's router, and @auth/core's default redirect
 * callback for the GitHub provider) run it through the WHATWG URL parser
 * first — which folds backslashes into forward slashes and strips
 * tabs/CR/LF *before* parsing. A string test approved values the parser
 * later rewrote into an absolute, off-origin URL ("/\\evil.com" -> parsed as
 * "https://evil.com/"). Fixed by parsing the INPUT against a sentinel origin
 * instead of string-testing it.
 *
 * Round two: parsing the input isn't enough either. `u.origin` on the parsed
 * INPUT compares equal to the sentinel, but the serialised
 * `pathname + search + hash` can itself start with "//" once dot-segments
 * normalise away against the sentinel's root — e.g. "/..//evil.com" parses
 * with origin intact, but its pathname comes back as "//evil.com". The
 * caller's sink (next/navigation's router) then re-parses THAT string as
 * protocol-relative and leaves the site. A parsed input can still produce an
 * output that is dangerous once re-parsed.
 *
 * So the value that gets returned must itself be round-tripped through the
 * same parser one more time: validate the value you are actually going to
 * hand to the sink, re-parsed the way the sink will parse it. The first
 * version validated the input; the second validated a parse of the input;
 * only checking the parse of the OUTPUT validates what the sink actually
 * sees.
 */
const SENTINEL = 'https://x.invalid'

export function safeCallbackUrl(raw: string | undefined): string {
  if (!raw) return '/sets'
  try {
    const u = new URL(raw, SENTINEL)
    if (u.origin !== SENTINEL) return '/sets'
    const out = u.pathname + u.search + u.hash
    // Re-parse the OUTPUT, not the input: dot-segment normalisation against
    // the sentinel root can turn a same-origin-looking input into a
    // pathname that starts with "//", which a sink re-parses as
    // protocol-relative and off-origin.
    if (new URL(out, SENTINEL).origin !== SENTINEL) return '/sets'
    return out
  } catch {
    return '/sets'
  }
}
