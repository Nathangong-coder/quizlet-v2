/**
 * Cards per extraction call. The pipe/semicolon importer creates 100+ cards in
 * one save; one call per card would exhaust the user's key pool and surface as
 * `quota_exhausted` across their whole account.
 *
 * Lives here (not in the `'use server'` action file that uses it) because a
 * "use server" module may only export async functions — a plain constant
 * export there is a hard Next.js build error.
 */
export const KLP_BATCH_SIZE = 10
