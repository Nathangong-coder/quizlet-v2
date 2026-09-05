import { prisma } from '@/lib/db'
import { writeKlpVersion, type KlpRowInput } from '@/lib/cards/klp-write'
import { klpSourceHash, type HashableBlock } from '@/lib/cards/klp-hash'
import type { AuthoringOutcome } from '@/lib/klp/authoring'

/** The card content `persistAuthoring` needs — exactly what `klpSourceHash` takes. */
export interface AuthoredCardContent {
  term: string
  definition: string
  blocks?: HashableBlock[]
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
 *
 * STEPS 2-4 RUN IN ONE `prisma.$transaction`. `writeKlpVersion` (step 1) is
 * deliberately NOT inside it — it already runs its own transaction plus a
 * P2002 retry, and nesting Prisma transactions invites exactly the kind of
 * trouble this fix exists to remove. But 2-4 are three independent,
 * un-transacted calls without this wrapper: a `CardAuthoring` row can commit
 * while `authoringProbe.createMany` or `klpRelation.createMany` then throws
 * (a transient DB error over a 50-card run is not exotic). The resumability
 * check in `scripts/author-klps.ts` gates on `CardAuthoring` existing at the
 * card's `klpVersion` — a bare `findFirst`, not a status check — so a
 * surviving partial row (real `separationScore`, `status: 'separated'`, zero
 * probes, zero relations) reads as "already authored" FOREVER. No later run,
 * even with the card's `klpStatus` correctly marked `'failed'`, would ever
 * touch it again without `--force` re-spending budget on the whole set. With
 * 2-4 atomic, a failure anywhere in them leaves NOTHING committed: the next
 * run's resumability check finds no row and correctly re-authors. Re-running
 * one card costs one superseded KLP version — the versioning model (Task 6)
 * working as intended, not a leak.
 *
 * `content` MUST be the card's own current `term`/`definition`/content blocks,
 * hashed with `klpSourceHash` — the exact same function the legacy extraction
 * path (`src/actions/klp.ts`) uses. This is not a preference, it is the only
 * correct value: `writeKlpVersion` writes whatever hash it is given into
 * `CardKlp.sourceHash` / `Card.klpSourceHash`, and that column is the ONLY
 * signal `selectStaleCardIds` (`src/lib/cards/stale.ts`) has for whether a
 * card's KLPs still match its content — it recomputes `klpSourceHash` fresh
 * from the card's CURRENT fields on every set save and compares it to what's
 * stored. A hash derived from anything else (an earlier version of this
 * function hashed the authored artifact — the reference answer and KLP
 * texts — instead) will never equal that fresh recomputation, so the card
 * reads as permanently stale and gets queued for the legacy extractor on the
 * owner's very next set save. That extractor calls `writeKlpVersion` again
 * and SUPERSEDES whatever is there — five discrimination-tested KLPs
 * replaced by roughly two cheap ones, silently, with no error and no log.
 * Passing a precomputed hash instead of card content was considered and
 * rejected: a caller that can pass a hash can pass the WRONG hash, and there
 * is exactly one correct value here, so computing it in the one place that
 * writes it removes an entire class of mistake.
 */
export async function persistAuthoring(
  cardId: string,
  outcome: AuthoringOutcome,
  promptVersion: number,
  content: AuthoredCardContent,
): Promise<{ authoringId: string; klpIds: string[] }> {
  const rows: KlpRowInput[] = outcome.klps.map((k) => ({
    text: k.text,
    weight: k.weight,
    kind: k.kind,
    source: 'ai',
    promptVersion,
  }))

  const hash = klpSourceHash({ term: content.term, definition: content.definition, blocks: content.blocks })
  const { version, klpIds } = await writeKlpVersion(cardId, rows, hash)

  const authoringId = await prisma.$transaction(async (tx) => {
    const authoring = await tx.cardAuthoring.create({
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
      await tx.authoringProbe.createMany({
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
      await tx.klpRelation.createMany({
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

    return authoring.id
  })

  return { authoringId, klpIds }
}
