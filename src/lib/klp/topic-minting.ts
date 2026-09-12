/**
 * Topic minting: the proposal schema, the prompt, and the `kind` prior.
 *
 * Lifted out of `scripts/probe-topic-minting.ts` (2026-09-11) so that the
 * reconciler (`topic-reconcile.ts`) and its tests can import the proposal
 * type without importing a script. Still PROBE-STAGE: nothing here writes.
 * Design: `docs/superpowers/specs/2026-09-11-dual-model-topic-minting-design.md`.
 */
import { z } from 'zod'
import { KLP_KINDS } from '@/lib/ai/schemas'
import { RELATABLE_TYPES } from '@/lib/klp/relations'

export type RelatableType = (typeof RELATABLE_TYPES)[number]
export type KlpKind = (typeof KLP_KINDS)[number]

/**
 * The proposal for ONE card. `klpRefs` are indices into the card's KLP list as
 * sent; cuids are never shown to the model, per the rest of the pipeline.
 */
export const CardTopicProposalSchema = z.object({
  parent: z
    .string()
    .describe('The umbrella concept this card sits under. 1-4 words, lowercase.'),
  leaves: z
    .array(
      z.object({
        name: z.string().describe('A specific, independently-failable concept. 1-5 words.'),
        klpRefs: z.array(z.number().int()).min(1),
      }),
    )
    .min(0)
    .max(6),
  contexts: z
    .array(
      z.object({
        klpRef: z.number().int(),
        concept: z
          .string()
          .describe('A PROCESS this point also touches, e.g. "non-cash adjustments".'),
      }),
    )
    .max(10),
  /**
   * KLPs whose content IS a link between two concepts, emitted as edges rather
   * than leaves. `from`/`to` must be STANDALONE concept names spelled exactly
   * as a leaf would be — that is the whole mechanism by which the graph
   * crosses card boundaries.
   */
  relations: z
    .array(
      z.object({
        klpRef: z.number().int(),
        from: z.string().describe('A standalone concept name, exactly as a leaf would be named.'),
        to: z.string().describe('A standalone concept name, exactly as a leaf would be named.'),
        type: z.enum(RELATABLE_TYPES),
      }),
    )
    .max(8),
})

export type CardTopicProposal = z.infer<typeof CardTopicProposalSchema>

export type ExpectedShape = 'leaf' | 'edge' | 'either'

/**
 * The `kind` PRIOR: what shape a key point of each kind usually takes.
 *
 * `kind` (`KLP_KINDS`) is set when the KLP is authored and, until this table,
 * was printed to the minting model as a hint that nothing read. Part F of
 * `docs/ai/card-tagging-axes.md` showed a `contrast` KLP that two models made
 * a `confused_with` edge and three made a leaf — the label was there and did
 * nothing. It is a DEFAULT the model may override; TypeScript flags a
 * proposal that contradicts it as `kind_conflict` in the merge notes. (It was
 * a judge trigger for one run; the owner then ruled that an edge always beats
 * a leaf, so the flag is now visibility, not a decision.)
 *
 * Every member of `KLP_KINDS` must have an entry — a kind added without one
 * would silently read as `either`. A test pins that.
 */
export const EXPECTED_SHAPE: Record<KlpKind, ExpectedShape> = {
  contrast: 'edge',
  causal: 'edge',
  condition: 'edge',
  mechanism: 'either',
  definition: 'leaf',
  quantitative: 'leaf',
  example: 'leaf',
}

/** The edge type a kind defaults to when it becomes an edge. */
export const DEFAULT_EDGE_TYPE: Partial<Record<KlpKind, RelatableType>> = {
  contrast: 'confused_with',
  causal: 'causes',
  condition: 'applies_within',
}

export interface PromptKlp {
  ref: number
  text: string
  kind: string
}

export function buildTopicMintingPrompt(term: string, klps: PromptKlp[]): string {
  const lines = klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n')
  return `You are building the topic hierarchy for a finance study library.

Below is ONE flashcard and every Key Learning Point (KLP) it teaches. A KLP is one
specific claim a learner must be able to state, and each one can be graded right or
wrong on its own. Each KLP is labelled with its kind in parentheses.

Card: ${term}

KLPs:
${lines}

Produce the small piece of topic hierarchy these points belong to.

RULE 1 — ONE PARENT, SPECIFIC CHILDREN.
Give a "parent" concept the card sits under, then "leaves" beneath it. The parent is
allowed to be somewhat general; the leaves must not be.

RULE 2 — THE FAILURE-GRAIN RULE. THIS IS THE MOST IMPORTANT ONE.
A learner must be able to fail exactly one leaf at a time. If a learner could get one
claim right and another wrong, those two claims belong to DIFFERENT leaves.
  Card about DSCR and FCCR ->
    parent: "debt coverage ratios"
    leaves: "debt service coverage ratio", "fixed charge coverage ratio"
  NOT one merged leaf called "debt service coverage" — a learner can know DSCR and not
  know FCCR, and a merged leaf cannot record that.
Conversely, do NOT split a single indivisible claim into two leaves to look thorough.

RULE 3 — NAME THE SUBJECT, NOT THE SETTING.
Many points say what happens to a financial statement. The statement is WHERE it
happens, not what the point is about. Never use a statement name, or a statement name
with a word added ("cash flow statement mechanics"), as a leaf.
  "On the Income Statement, a $10 SBC increase reduces Net Income by $6"
     subject leaf -> "stock-based compensation expense"
  "Share repurchases reduce cash in the financing section"
     subject leaf -> "share repurchases"
THE ONE EXCEPTION: a (definition) point that describes what a statement IS or DOES may
attach to the statement itself — there the statement is the subject. When you do that,
ALSO emit what the statement does as a context or a relation, so the point carries the
mechanism and not only the container:
  "The income statement captures profitability over a period by netting expenses
   against revenue to reach net income"
     leaf -> "income statement"
     context -> "profitability measurement"
     relation -> { from: "revenue", to: "net income", type: "precedes" }

RULE 4 — SETTINGS ARE STILL RECORDED, AT PROCESS GRAIN.
For each KLP that genuinely operates inside a statement, add a "contexts" entry naming
the PROCESS it operates inside, never the statement.
  GOOD contexts: "non-cash adjustments", "financing cash flow", "working capital changes",
                 "operating cash flow", "deferred taxes", "equity rollforward"
  BAD contexts:  "income statement", "cash flow statement", "balance sheet" — too broad,
                 these are containers and the app already knows the containment.
A context must be a DIFFERENT concept from the KLP's own leaf. A KLP with no meaningful
process gets no context entry. Do not invent one, and do not restate the KLP as one.

RULE 5 — MINT FREELY. PREFER SPECIFIC, PLAIN NOUNS.
There is no list of approved names. Invent the precise concept. Never reach for a broad
container like "leverage", "financial metrics", "accounting", "technicals" or
"valuation" as a LEAF — those are acceptable only as a parent, and usually not even
then. Name the thing itself, not a description of it: "gross profit", not "gross profit
calculation"; "accounting equation", not "accounting equation structure".

RULE 6 — COVER EVERY KLP, as either ONE leaf member or ONE OR MORE relations.
Every ref above appears in exactly one leaf's klpRefs, OR in one or more relations
(a point that states two links is two relations). Never both — except the rule 3
definition case, where the statement leaf and its mechanism relation sit together.

RULE 7 — A KLP THAT IS A LINK BECOMES A RELATION, NOT A LEAF.
Some points do not describe a thing; they describe how two things connect
("net income flows into retained earnings", "depreciation is added back to operating
cash flow"). Emit those as "relations", and do NOT invent a leaf for them.

  "Net income flows into retained earnings on the balance sheet"
     -> relation { from: "net income", to: "retained earnings", type: "precedes" }
     NOT a leaf called "net income retained earnings linkage"

BOTH ENDPOINTS MUST BE STANDALONE CONCEPT NAMES, spelled exactly as you would name a
leaf. This is the point of the rule: another card will mint "retained earnings" as its
own leaf, and the two must meet on the name so the map joins up across cards. A phrase
that describes the link instead of naming its ends connects to nothing.
  GOOD: from "depreciation", to "operating cash flow"
  BAD:  from "depreciation add-back mechanic", to "cash flow impact"

Edge types, use the closest one:
  causes          — A brings B about
  requires        — B cannot be computed or stated without A
  precedes        — A comes before B in a sequence or flows into it
  applies_within  — A operates inside B (depreciation applies_within operating cash flow)
  confused_with   — learners routinely mistake A for B

Prefer naming a WIDELY-REUSABLE concept at each end. "net income", "operating cash
flow", "retained earnings" are reusable; "the year-1 net income figure" is not.

RULE 8 — THE KIND LABEL IS A DEFAULT FOR THE SHAPE.
Each KLP's kind, in parentheses, tells you what shape it usually takes. Follow the
default unless the point clearly is not that shape.
  (contrast)      -> almost always a relation of type confused_with between the two
                     things being contrasted
  (causal)        -> usually a relation (causes or precedes)
  (condition)     -> usually a relation of type applies_within
  (definition), (quantitative), (example) -> a leaf
  (mechanism)     -> a leaf, unless the point is about how two named things connect

Names are lowercase noun phrases, no articles, no trailing punctuation. Spell out an
abbreviation the first time it is the leaf name (write "fixed charge coverage ratio",
not "FCCR"; "earnings before interest and taxes", not "EBIT").`
}
