/**
 * Where absolute links in outgoing mail point.
 *
 * FROM ENV, NEVER FROM THE REQUEST. Building an absolute URL out of the `Host`
 * header is the classic poisoned-reset-link bug: an attacker sets
 * `Host: evil.com`, and your server mails *your user* a link carrying their
 * own valid token, on the attacker's domain. There is deliberately no request
 * parameter here for anyone to reach for.
 *
 * The parameter type is deliberately narrower than `NodeJS.ProcessEnv` — it
 * names the only two variables this function consults, which is what lets a
 * test pass a plain `{ NEXTAUTH_URL: '...' }` literal without inventing a
 * `NODE_ENV` to satisfy an interface it doesn't need. The trailing index
 * signature isn't for callers — it exists purely so `process.env` (whose own
 * type has no property literally named `NEXTAUTH_URL`/`VERCEL_URL`, only an
 * index signature) still satisfies this type as the default argument;
 * without it, TS's weak-type check ("all-optional target, no property names
 * in common with the source") rejects the assignment even though every
 * runtime lookup below works fine either way.
 */
export function appOrigin(
  env: { NEXTAUTH_URL?: string; VERCEL_URL?: string; [key: string]: string | undefined } = process.env,
): string {
  const explicit = env.NEXTAUTH_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const vercel = env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel}`

  return 'http://localhost:3000'
}
