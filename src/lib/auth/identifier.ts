import { normalizeHandle } from '@/lib/users/handle'

/**
 * Accept EITHER an email or a handle in the one sign-in field.
 *
 * Costs one extra `OR` branch and removes the most common login failure —
 * "which one did I use?". There is no ambiguity to resolve: a handle cannot
 * contain `@` (see HANDLE_PATTERN), so the two branches can never both match
 * different users.
 *
 * Pure and bcrypt-free on purpose, so it can be tested without hashing and
 * stays safe to import from anywhere.
 */
export function identifierWhere(raw: string) {
  const needle = normalizeHandle(raw)
  return { OR: [{ email: needle }, { normalizedHandle: needle }] }
}
