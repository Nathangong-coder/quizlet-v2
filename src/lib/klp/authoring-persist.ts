import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { writeKlpVersion, type KlpRowInput } from '@/lib/cards/klp-write'
import type { AuthoringOutcome } from '@/lib/klp/authoring'

/**
 * `writeKlpVersion` needs a source fingerprint for `CardKlp.sourceHash` (and,
 * via it, `Card.klpSourceHash`). The legacy extraction path
 * (`src/actions/klp.ts`) fingerprints the card's own term/definition/blocks
 * with `klpSourceHash` (`src/lib/cards/klp-hash.ts`) so `selectStaleCardIds`
 * can tell whether a later edit invalidated the KLPs. `persistAuthoring` has
 * no access to the card's raw fields — only to what `authorCard` already
 * derived from them (`outcome`) — so this fingerprints the AUTHORED ARTIFACT
 * instead: the reference answer plus every KLP's kind and text.
 *
 * KNOWN GAP, flagged rather than silently accepted: this is NOT the same
 * contract the legacy path relies on. An authored card's stored hash will not
 * equal a fresh `klpSourceHash(term, definition)`, so `selectStaleCardIds`
 * will read every authored card as permanently stale and queue it for legacy
 * re-extraction on the next set save — which would silently clobber the
 * discrimination-tested KLPs with the crude 1-call extractor. Reconciling the
 * two staleness mechanisms is out of scope for this task (the brief pins
 * `persistAuthoring`'s signature to `(cardId, outcome, promptVersion)`, with
 * no card content available to hash) and is called out in the task report as
 * a gap for a later task.
 */
function authoredContentHash(outcome: AuthoringOutcome): string {
  const parts = [outcome.referenceAnswer, ...outcome.klps.map((k) => `${k.kind}:${k.text}`)]
  return createHash('sha256').update(parts.join('\n')).digest('hex')
}

/**
 * Persists one `authorCard` outcome (design doc §1, Task 9): the KLPs with
 * their COMPUTED weights (never a model-supplied number — audit finding G1),
 * the authoring run itself, its probes, and its relations with indexes
 * mapped onto real ids.
 *
 * ORDER IS LOAD-BEARING and pinned by `tests/klp/authoring-persist.test.ts`:
 *  1. `writeKlpVersion` FIRST — it returns the real `CardKlp` ids, and
 *     nothing downstream has anything to point at until they exist.
 *  2. `cardAuthoring.create` — the run itself, referencing that version.
 *  3. `authoringProbe.createMany` — the three adversarial answers.
 *  4. `klpRelation.createMany` — LAST, because a relation's endpoints are
 *     KLP INDEXES until step 1 hands back ids; mapping index -> id is what
 *     turns a graph edge into a fact about a real proposition.
 *
 * Each `createMany` is skipped entirely when its input is empty, rather than
 * issuing a no-op query.
 */
export async function persistAuthoring(
  cardId: string,
  outcome: AuthoringOutcome,
  promptVersion: number,
): Promise<{ authoringId: string; klpIds: string[] }> {
  const rows: KlpRowInput[] = outcome.klps.map((k) => ({
    text: k.text,
    weight: k.weight,
    kind: k.kind,
    source: 'ai',
    promptVersion,
  }))

  const { version, klpIds } = await writeKlpVersion(cardId, rows, authoredContentHash(outcome))

  const authoring = await prisma.cardAuthoring.create({
    data: {
      cardId,
      klpVersion: version,
      promptVersion,
      referenceAnswer: outcome.referenceAnswer,
      separationScore: outcome.separationScore,
      revisions: outcome.revisions,
      status: outcome.status,
    },
  })

  if (outcome.probes.length > 0) {
    await prisma.authoringProbe.createMany({
      data: outcome.probes.map((p) => ({
        authoringId: authoring.id,
        kind: p.kind,
        text: p.text,
        score: p.score,
        verdicts: p.verdicts,
      })),
    })
  }

  if (outcome.relations.length > 0) {
    await prisma.klpRelation.createMany({
      data: outcome.relations.map((r) => ({
        fromKlpId: klpIds[r.from],
        toKlpId: klpIds[r.to],
        type: r.type,
        provenance: r.provenance,
        rationale: r.rationale,
        probe: r.probe,
      })),
    })
  }

  return { authoringId: authoring.id, klpIds }
}
