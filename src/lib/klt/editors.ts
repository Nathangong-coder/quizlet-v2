/**
 * Which users get OPERATOR REACH into a set they do not own.
 *
 * Structure is per-set (`SetKltNode`), so after Decision 4 this list widens
 * WHICH SETS an operator can open — never what an edit inside one DOES. An
 * admin's edit still affects exactly one set's structure, exactly like an
 * owner's; `requireSetKltAccess` (`src/lib/klt/access.ts`) is what actually
 * decides access and resolves the one `setId` every write scopes to. This
 * list is not a blast-radius control — see that file for the real rationale.
 * Same posture as `npm run invite`, still: an operator capability, configured
 * out-of-band, not a user-facing permission — for a power user tending their
 * own deck, ownership alone is already enough (no allowlist needed); this is
 * how an operator helps someone else's set, or authors an install-wide preset.
 *
 * Unset means NOBODY, never everybody. A gate that opens when its config is
 * missing is not a gate.
 */
export function parseKltEditors(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function isKltEditor(userId: string): boolean {
  // An empty id must never match, however sloppy the configured list is.
  if (userId.length === 0) return false
  return parseKltEditors(process.env.KLT_EDITORS).includes(userId)
}
