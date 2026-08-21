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
 * names only the two variables this function consults, which is what lets a
 * test pass a plain `{ NEXTAUTH_URL: '...' }` literal (or `{}`) without
 * inventing a `NODE_ENV` to satisfy an interface it doesn't need, and what
 * lets a misspelled key (`NEXTAUTH_URLX`) get flagged at a call site instead
 * of silently reading as `undefined`. The cast lives on the default-argument
 * expression, not the parameter type, because `process.env`'s own type has
 * no property literally named `NEXTAUTH_URL`/`VERCEL_URL` — only an index
 * signature — so assigning it directly trips TS's weak-type check ("all
 * properties optional on the target, no property names in common with the
 * source"). Casting only the default keeps that compatibility bridge local
 * to this one call and off the type callers see.
 */
type Env = { NEXTAUTH_URL?: string; VERCEL_URL?: string }

export function appOrigin(env: Env = process.env as Env): string {
  const explicit = env.NEXTAUTH_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const vercel = env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel}`

  return 'http://localhost:3000'
}
