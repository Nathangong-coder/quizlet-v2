import { prisma } from '@/lib/db'
import { PANEL_LEVELS, type PanelLevel } from '@/lib/klp/panel'

/**
 * Loading a card's EXISTING panel so a re-authoring run grades the same five
 * answers it graded last time.
 *
 * ## The problem this solves, in one sentence
 *
 * A panel written fresh on every authoring run makes two runs incomparable: a
 * higher separation score could mean the key points got sharper, or it could
 * mean this run happened to draw a weaker panel.
 *
 * Within a single run the panel is already fixed — `authorCard` writes it once
 * before the revision loop. Across runs it was not, because a panel is stored
 * as `AuthoringProbe` rows hanging off `CardAuthoring`, and a `CardAuthoring`
 * row belongs to ONE `klpVersion`. Re-authoring a card writes a new version, a
 * new authoring row, and therefore a new panel.
 *
 * ## Why no migration is needed
 *
 * `AuthoringProbe.text` already persists the answer verbatim. So the previous
 * run's panel can simply be read back and reused. Keying a panel to the CARD
 * rather than the version needs no new table — only the discipline of looking
 * for one before writing one.
 *
 * ## What makes a stored panel reusable
 *
 * Its `kind` must be a panel LEVEL. Historic probes carry the three
 * failure-kind archetypes (`confident_wrong`, `vague`, `memorized_template`),
 * which are not levels and must never be silently treated as one — they are a
 * different instrument, and mixing them would put two scales inside one curve.
 *
 * And it must be COMPLETE. A partial panel is useless rather than merely
 * reduced: the measurement is a curve across ordered levels, so a missing L3
 * removes exactly the near-miss the panel exists to provide. An incomplete
 * stored panel is ignored and a fresh one is written.
 *
 * THE PANEL IS NOT RE-VALIDATED AGAINST THE NEW KEY POINTS, and that is the
 * point rather than an oversight. Its whole value is being the same fixed
 * yardstick across versions. Checking it still "fits" the current key points
 * would reintroduce the coupling the reuse exists to break.
 */
export interface StoredPanel {
  members: { level: PanelLevel; text: string }[]
  /** Which klpVersion first wrote it — for the run log, not for logic. */
  fromKlpVersion: number
}

function isPanelLevel(kind: string): kind is PanelLevel {
  return (PANEL_LEVELS as readonly string[]).includes(kind)
}

/**
 * The most recent COMPLETE panel stored for this card, or null.
 *
 * Walks authoring runs newest-first rather than taking only the latest: a run
 * that failed, or one made before the panel existed, has no panel, and the run
 * before it may well have one. Stopping at the newest row would throw away a
 * usable yardstick because of one unrelated failure.
 */
export async function findExistingPanel(cardId: string): Promise<StoredPanel | null> {
  const runs = await prisma.cardAuthoring.findMany({
    where: { cardId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { klpVersion: true, probes: { select: { kind: true, text: true } } },
  })

  for (const run of runs) {
    const members = run.probes
      .filter((p) => isPanelLevel(p.kind) && p.text.trim().length > 0)
      .map((p) => ({ level: p.kind as PanelLevel, text: p.text }))

    const byLevel = new Map(members.map((m) => [m.level, m]))
    if (byLevel.size !== PANEL_LEVELS.length) continue

    return {
      // Ordered strongest-first here, not trusted from storage: every curve
      // statistic downstream reads position as competence.
      members: PANEL_LEVELS.map((l) => byLevel.get(l)!),
      fromKlpVersion: run.klpVersion,
    }
  }

  return null
}
