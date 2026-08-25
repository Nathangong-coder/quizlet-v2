/**
 * Cards per summarization call.
 *
 * Lives here, not in `src/actions/klt.ts`: a `'use server'` module may export
 * only async functions, and exporting a plain constant from one 500s the whole
 * route while both `tsc` and vitest stay silent. Mirrors
 * `src/lib/cards/klp-batch.ts`.
 */
export const KLT_BATCH_SIZE = 10
