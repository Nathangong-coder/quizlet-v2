/**
 * Restrict a `?callbackUrl=` query value to a same-origin relative path.
 *
 * A naive `raw.startsWith('/') && !raw.startsWith('//')` string check
 * inspects the RAW string, but the sinks that actually consume this value
 * (next/navigation's router, and @auth/core's default redirect callback for
 * the GitHub provider) run it through the WHATWG URL parser first — which
 * folds backslashes into forward slashes and strips tabs/CR/LF *before*
 * parsing. That means a string test can approve a value the parser later
 * rewrites into an absolute, off-origin URL:
 *
 *   "/\\evil.com"        -> parsed as "https://evil.com/"
 *   "/\tevil.com"        -> tab stripped -> "https://evil.com/"
 *
 * The fix is to parse-and-reserialize with the same parser the sinks use,
 * against a fixed sentinel origin, and only keep the value if the parser
 * agrees the origin never changed. What reaches the caller is a value the
 * parser produced, not one a string test merely approved.
 */
export function safeCallbackUrl(raw: string | undefined): string {
  if (!raw) return '/sets'
  try {
    const sentinel = 'https://x.invalid'
    const u = new URL(raw, sentinel)
    if (u.origin !== sentinel) return '/sets'
    return u.pathname + u.search + u.hash
  } catch {
    return '/sets'
  }
}
