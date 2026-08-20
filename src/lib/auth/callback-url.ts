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
 * against a DIFFERENT one (CHECK_ORIGIN) than the one used to parse the
 * input (PARSE_ORIGIN). Belt and braces: also require the output to start
 * with "/" and not "//" — sound here, unlike v1, because this is a check of
 * the OUTPUT the sink will receive, not the raw input.
 *
 * The two checks are not symmetric. `startsWith` is the PRIMARY guard — it
 * alone rejects every payload this file's tests exercise, including the
 * same-sentinel escape from round three ("/..//x.invalid" -> "//x.invalid").
 * Swap CHECK_ORIGIN back to PARSE_ORIGIN and no test reddens, because
 * `startsWith` independently catches what the origin re-check was built to
 * catch. The origin re-check is DEPTH, not load: what it is actually for is
 * an output that starts with a single "/" — so `startsWith` waves it
 * through — yet still changes origin once the sink re-parses it, e.g. a
 * pathname literally containing "/\evil.com". No such output is currently
 * reachable from `u.pathname`, because the parser that produced it already
 * folds a backslash into a forward slash before `pathname` is read. The
 * re-check stays anyway because "not reachable" is a claim about PARSER
 * BEHAVIOUR, and each of the three rounds above died from exactly that kind
 * of claim turning out to be wrong.
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
    // PARSE_ORIGIN — not because a same-sentinel check would let something
    // through here (it wouldn't: `startsWith` below independently catches
    // every same-sentinel escape this file's tests exercise), but as depth
    // against a parser-behaviour claim this file has already been wrong
    // about three times.
    if (new URL(out, CHECK_ORIGIN).origin !== CHECK_ORIGIN) return '/sets'
    // This is the PRIMARY guard, sound here (unlike v1) because it checks
    // the OUTPUT the sink will receive, not the raw input. Opaque-path
    // schemes like "blob:https://x.invalid/uuid" never actually reach this
    // line to be caught by it — their pathname is the whole embedded
    // absolute URL, so the origin recheck above already rejects them one
    // check earlier (its re-parsed origin is never CHECK_ORIGIN). What DOES
    // reach this line, and is the one thing only this check catches, is an
    // escape that targets CHECK_ORIGIN's own host name (e.g.
    // "/..//y.invalid") — the origin recheck above passes that by
    // construction, since CHECK_ORIGIN is itself just another nameable
    // string once someone can read this file.
    if (!out.startsWith('/') || out.startsWith('//')) return '/sets'
    return out
  } catch {
    return '/sets'
  }
}
