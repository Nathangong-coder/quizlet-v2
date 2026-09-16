/**
 * ANCHORED MINTING — prompt v2 (2026-09-15, from the owner's read of the
 * deferred-revenue card on the matcher trace).
 *
 * Five things v1 got wrong on that card, each now a rule the output is
 * measured against (`src/lib/klp/topic-settings.ts`):
 *
 *  1. THE ANCHOR. The question is about ONE thing ("deferred revenue"); the
 *     first point usually defines it. Every leaf branches from it — directly
 *     or through another leaf (`under`) — and it is the default context, so a
 *     later "revenue recognition" point is still deferred-revenue-in-a-merger.
 *  2. THE DOMAIN. The anchor sits under the set's domain ("mergers and
 *     acquisitions"), not under the accounting tree. "Deferred revenue" under
 *     M&A and "deferred revenue" under the balance sheet are the same global
 *     concept placed in two places; an insight names the placement.
 *  3. CAUSAL POINTS OWN THEIR EDGE AND NAME THEIR CAUSE. A (causal) point, or
 *     any point built on "because", is a relation with klpRef = itself: `to`
 *     is the effect it states, `from` is the cause — normally the leaf of an
 *     EARLIER point (`causeKlpRef`), whose words it borrows and trims. The
 *     first draft of this prompt let the definition point own the edges and
 *     the causal points became leaves; the owner's reading is the reverse.
 *  4. NAMES ARE SHORT AND SPLIT. At most four words; a compound name becomes a
 *     leaf and a sub-leaf ("historical deferred revenue treatment" >
 *     "fair value write-down"); a change of regime becomes a leaf plus a
 *     `precedes` edge (asc 606 —precedes→ asu 2021-08).
 *  5. COVERAGE. Every point carries at least one leaf or one relation; a
 *     context alone is not coverage.
 *
 * None of these is a hard gate in the prompt — the owner asked for settings
 * like the KLP ones, measured and revised, not rigid rules — so the prompt
 * states them as the shape of a good answer and TypeScript reports how
 * closely each card follows them.
 */
import { z } from 'zod'
import { RELATABLE_TYPES } from '@/lib/klp/relations'
import type { PromptKlp } from '@/lib/klp/topic-minting'
import { modeInstruction, type CardMode } from '@/lib/klp/card-mode'

export const MAX_NAME_WORDS = 4

export const CardTopicProposalV2Schema = z.object({
  /** The one thing the question is about. Usually what the first point defines. */
  anchor: z.string(),
  /** The set-level domain the anchor sits under, e.g. "mergers and acquisitions". */
  domain: z.string(),
  leaves: z
    .array(
      z.object({
        name: z.string(),
        klpRefs: z.array(z.number().int()).min(1),
        /** The leaf this one branches from — another leaf's name, or the anchor. */
        under: z.string(),
      }),
    )
    .max(10),
  contexts: z.array(z.object({ klpRef: z.number().int(), concept: z.string() })).max(10),
  relations: z
    .array(
      z.object({
        klpRef: z.number().int(),
        from: z.string(),
        to: z.string(),
        type: z.enum(RELATABLE_TYPES),
        /** For a causal point: the EARLIER point whose leaf supplies `from` (the cause). */
        causeKlpRef: z.number().int().optional(),
      }),
    )
    .max(12),
})
export type CardTopicProposalV2 = z.infer<typeof CardTopicProposalV2Schema>

/**
 * `mode` (2026-09-15, `card-mode.ts`): the writer's question type turned into
 * a minting instruction — an applied scenario mints the SKILL it exercises,
 * not the case's own facts. Optional so every existing caller and the run
 * files that predate it are unchanged; the loop passes it when it knows it.
 */
export function buildTopicMintingPromptV2(term: string, setTitle: string, klps: PromptKlp[], linksBlock = '', mode?: CardMode): string {
  const lines = klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n')
  const modeBlock = mode ? `${modeInstruction(mode)}\n\n` : ''
  return `You are building the topic map for ONE flashcard in a finance study library. Below are the card's Key Learning Points (KLPs) — each a claim a learner can get right or wrong on its own — and, where it exists, the card's own relation graph.

Study set (the domain): ${setTitle}
Card: ${term}

KLPs:
${lines}

${modeBlock}${linksBlock}Produce the piece of topic map these points belong to, as JSON.

THE ANCHOR — do this first.
Name the ONE thing the question is about: "anchor". It is usually what the first point defines (a question about deferred revenue in a merger has the anchor "deferred revenue"). Then name the "domain" it sits under here — the study set's subject in two or three words ("mergers and acquisitions", "accounting", "leveraged buyouts"). The same concept can exist under another domain (deferred revenue under the balance sheet); this card's copy lives under THIS domain, so name the domain the way the set means it.

LEAVES BRANCH FROM THE ANCHOR.
Every leaf has an "under": the anchor, or another leaf on this card that it is a part of. Nothing on the card sits outside the anchor's branch. A point that only says what the anchor IS attaches to the anchor itself (leaf name = anchor, under = anchor).

NAMES: SHORT, PLAIN NOUNS, AT MOST ${MAX_NAME_WORDS} WORDS.
Name the thing, not a description of it. When a name wants to be longer than ${MAX_NAME_WORDS} words, it is two things: split it into a leaf and a sub-leaf under it.
  NOT  "acquired deferred revenue write-down"
  BUT  leaf "historical deferred revenue treatment" (under the anchor)
       sub-leaf "fair value write-down" (under "historical deferred revenue treatment")
A change of regime is a leaf for the new regime plus a relation from the old one:
  leaf "asu 2021-08" (under "deferred revenue accounting change")
  relation { from: "asc 606", to: "asu 2021-08", type: "precedes" }
Take the words from the point's own text. Spell out abbreviations the first time they name a leaf.

CAUSAL POINTS OWN THEIR EDGE, AND NAME THEIR CAUSE.
A (causal) point, and any point whose claim rests on "because", "so", "which means", is a relation whose "klpRef" is THAT point — never a leaf, and never an edge hung on the definition point instead. Do it in this order: (a) "to" is the effect the point states, in its own words, trimmed to a noun phrase; (b) "from" is the cause — normally the leaf of an EARLIER point on the card; put that point's index in "causeKlpRef" and borrow its leaf's words; (c) trim words the leaf already carries. Type "causes" (A brings B about) or "precedes" (A comes before B, including an old regime before a new one); "applies_within" for a (condition) point; "confused_with" ONLY for a (contrast) point about two things learners mix up — a (causal) point never gets confused_with.
  [1] (definition) "Historically, the buyer wrote acquired deferred revenue down to fair value"
     -> leaf "historical deferred revenue treatment", sub-leaf "fair value write-down"
  [2] (causal) "Under the old fair-value treatment, less revenue was recognized after close because the liability covered only cost plus margin"
     -> relation { klpRef: 2, from: "fair value write-down", to: "post-close revenue", type: "causes", causeKlpRef: 1 }
        with context "historical deferred revenue treatment"
  The effect ("post-close revenue") needs no leaf of its own unless another point defines it.

CONTEXTS.
The anchor is every point's context by default and need not be written. Add a "contexts" entry only when a point ALSO operates inside a different process ("purchase price allocation", "goodwill"); never a statement name, never the point's own leaf.

EVERY POINT IS COVERED.
Each KLP index appears in at least one leaf's klpRefs or one relation's klpRef. A point with only a context is NOT covered. A point that states two links is two relations.

Edge types: ${RELATABLE_TYPES.join(', ')}.

Output JSON:
{
  "anchor": string, "domain": string,
  "leaves": [ { "name": string, "klpRefs": [number], "under": string } ],
  "contexts": [ { "klpRef": number, "concept": string } ],
  "relations": [ { "klpRef": number, "from": string, "to": string, "type": string, "causeKlpRef": number } ]
}
Names are lowercase noun phrases, no articles, no trailing punctuation.`
}

/** Read a v2 proposal as a v1 one, for every consumer that only knows v1 (the write step, the matcher, the enforcement report). */
export function toV1(p: CardTopicProposalV2): { parent: string; leaves: { name: string; klpRefs: number[] }[]; contexts: { klpRef: number; concept: string }[]; relations: { klpRef: number; from: string; to: string; type: (typeof RELATABLE_TYPES)[number] }[] } {
  return {
    parent: p.anchor,
    leaves: p.leaves.map((l) => ({ name: l.name, klpRefs: l.klpRefs })),
    contexts: p.contexts,
    relations: p.relations.map((r) => ({ klpRef: r.klpRef, from: r.from, to: r.to, type: r.type })),
  }
}
