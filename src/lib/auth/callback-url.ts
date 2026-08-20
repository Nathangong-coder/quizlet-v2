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
 * Round three: the value that gets returned must itself be round-tripped
 * through the same parser one more time — validate the value you are
 * actually going to hand to the sink, re-parsed the way the sink will parse
 * it. But round three re-parsed the output against the SAME sentinel it was
 * built from, so the guard was structurally blind to escapes that land back
 * on that exact sentinel host: "/..//x.invalid" parses to output "//x.invalid",
 * which re-parsed against "https://x.invalid" reports origin
 * "https://x.invalid" — a perfect match, so round three waved it through.
 * It only worked by accident, because ".invalid" is IANA-reserved and
 * nothing can navigate there for real; the guard would become a genuine open
 * redirect the moment someone "simplified" it by pointing the sentinel at
 * the site's real origin.
 *
 * Round four: parse the input against one sentinel, but validate the output
 * against a DIFFERENT one that the output has no way to legitimately name.
 * The output must be off-origin-safe against an origin it cannot possibly
 * reference — that is the property a same-sentinel check cannot test, because
 * a same-sentinel check can always be satisfied by an escape that resolves
 * back to the sentinel itself. Belt and braces: also require the output to
 * start with "/" and not "//" — sound here, unlike v1, because this is a
 * check of the OUTPUT the sink will receive, not the raw input — which also
 * catches `blob:` (and other opaque-path schemes) where the "output" the
 * parser hands back is an absolute URL, not a path at all.
 */
const PARSE_ORIGIN = 'https://x.invalid'
const CHECK_ORIGIN = 'https://y.invalid' // deliberately DIFFERENT from PARSE_ORIGIN

export function safeCallbackUrl(raw: string | undefined): string {
  if (!raw) return '/sets'
  try {
    const u = new URL(raw, PARSE_ORIGIN)
    if (u.origin !== PARSE_ORIGIN) return '/sets'
    const out = u.pathname + u.search + u.hash
    // Re-parse the OUTPUT, not the input: dot-segment normalisation against
    // the parse origin's root can turn a same-origin-looking input into a
    // pathname that starts with "//", which a sink re-parses as
    // protocol-relative and off-origin. Checked against CHECK_ORIGIN, not
    // PARSE_ORIGIN, so an escape that resolves back to the parse sentinel
    // itself cannot slip through disguised as a match.
    if (new URL(out, CHECK_ORIGIN).origin !== CHECK_ORIGIN) return '/sets'
    // Belt and braces on the OUTPUT: catches opaque-path schemes (e.g.
    // "blob:https://x.invalid/uuid") where the parser hands back an
    // absolute URL rather than a path at all. Also the only check that
    // stays airtight if an escape ever targets CHECK_ORIGIN's own host
    // name (e.g. "/..//y.invalid") — the origin recheck above would pass
    // that by construction, since CHECK_ORIGIN is itself just another
    // nameable string once someone can read this file.
    if (!out.startsWith('/') || out.startsWith('//')) return '/sets'
    return out
  } catch {
    return '/sets'
  }
}
