/**
 * Who may edit the GLOBAL concept tree.
 *
 * The tree is shared across every account, so one re-parent moves everyone's
 * topic mastery. That is why editing is an allowlist rather than an ordinary
 * owner check — there IS no owner. Same posture as `npm run invite`: an
 * operator capability, configured out-of-band, not a user-facing permission.
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
