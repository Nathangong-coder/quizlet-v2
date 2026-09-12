# Dual-model topic minting with a deterministic reconciler

**Status:** approved in chat 2026-09-11 (owner); BUILT the same day as a PROBE extension and run on 13 cards — findings in `docs/ai/card-tagging-axes.md` Part G, including the judge-weighting defect. Nothing here
writes to the database. Promotion into the authoring pipeline is a later decision, taken
after the owner has read a merged run and a human-labelled gold set exists for at least the
five accounting cards.

**Context:** BUILD-QUEUE item 2. `docs/ai/card-tagging-axes.md` Parts D-F measured three
single-model minting runs. Part F (five fixed cards, five models) established the two facts
this design rests on: models agree on NOUNS and disagree on the LEAF-OR-EDGE decision; and
every leaf/edge split between DeepSeek and gemini-3.6-flash was DeepSeek under-emitting
edges. The owner's read of the grid: DeepSeek is the best overall minter but over-produces
contexts and names things oddly; gemini-3.6-flash names things well ~80% of the time but
sometimes under-covers or mis-orders; when the two disagree on the TYPE of a thing, Gemini
is usually right.

## What the owner asked for, verbatim in substance

1. Use the KLP `kind` to guide leaf-vs-edge. Today it is printed as a hint and nothing reads it.
2. Mint with both DeepSeek and Gemini 3.6, but conserve tokens.
3. When they name the same concept differently, take the SHORTER name.
4. When they disagree on type (leaf / edge / context) for the same concept, Gemini wins.
5. When one model emits a leaf and a context with the same name on one KLP, it has
   mislabelled one of them and the point probably wants an edge.
6. A third model may judge "which is more right" but must never be asked "are both wrong";
   weight it slightly toward Gemini on naming/type conflicts. Adjudicator: **qwen3.7-flash**
   (uncapped, not a minter, so no self-preference).

## Components

### 1. `kind` prior — prompt rule 8 + `EXPECTED_SHAPE`

`KLP_KINDS` (`src/lib/ai/schemas.ts`) is a closed vocabulary set at authoring time. It
becomes a DEFAULT shape, stated in the prompt and pinned in TypeScript:

| kind | expected shape | default edge type |
| --- | --- | --- |
| `contrast` | edge | `confused_with` |
| `causal` | edge | `causes` / `precedes` |
| `condition` | edge | `applies_within` |
| `mechanism` | either | — |
| `definition` | leaf | — |
| `quantitative` | leaf | — |
| `example` | leaf | — |

The prompt states it as a default the model may override. TypeScript flags a proposal whose
shape contradicts the table as `kind_conflict`. The table is exported so a test pins it, and
`EXPECTED_SHAPE` must have an entry for every member of `KLP_KINDS` (tested) — a new kind
added without a shape would silently be "either".

### 2. `src/lib/klp/topic-reconcile.ts` — pure, zero AI, zero DB

Input: two `CardTopicProposal`s (A = DeepSeek, B = Gemini) for one card, plus the card's
KLPs with `kind`. Output: a `MergedProposal` where every leaf, edge and context carries a
`reason` string and, where applicable, an `unresolved` marker for the adjudicator.

**Alignment is by KLP index**, never by name. Both models saw the same numbered list, so
the question "are they talking about the same KLP" is already answered; only NAMES and
SHAPES need reconciling. This is the main token saving: the judge is never asked to align.

Rules, per KLP, in this order:

1. **Self-duplicate purge.** Within ONE model's proposal, a context whose normalized name
   equals that same model's leaf name or edge endpoint on the same KLP is dropped
   (`reason: purge:self-dup`) and the KLP is marked `shape_suspect`.
2. **Shape.** Both leaf, or both edge → keep. Split:
   - prior is `edge` or `either` → **edge wins** (`rule:edge-wins-by-kind`).
   - prior is `leaf` → `kind_conflict`, adjudicate.
   - a `shape_suspect` leaf against the other model's edge → edge wins
     (`rule:edge-wins-self-dup`).
   - one model covered the KLP and the other did not → take the one that did
     (`rule:only-coverage`).
3. **Leaf names, same shape.** `normalizeName`: lowercase; strip punctuation; expand
   `EBIT`/`EBITDA`/`D&A`/`FCF`/`PP&E`/`SBC`/`COGS`/`NI`/`OCF` (fixed table); drop ONE trailing
   noise word from `NOISE_SUFFIXES` (`concept`, `calculation`, `definition`, `structure`,
   `mechanics`, `derivation`, `purpose`, `components`, `flow`, `overview`). Then:
   - equal → same concept, **shorter original wins** by word count, tie → Gemini
     (`rule:shorter` / `rule:tie-gemini`).
   - one name's content tokens CONTAIN the other's, smaller side ≥ 2 tokens → same
     concept, shorter wins. (Built as containment, not Jaccard + head noun: `effective tax
     rate` / `marginal tax rate` share the head noun `rate` and would have merged; the test
     pins that pair apart. The two-token floor stops `assets` being swallowed by `long-term
     assets`.)
   - otherwise → `name_conflict`, adjudicate.
4. **Edges.** Same endpoints (after normalization), same type → keep. Same endpoints,
   different type → Gemini's type (`rule:type-gemini`). Different endpoints →
   `edge_conflict`, adjudicate. If only one model emitted an edge for the KLP and shape
   resolved to edge, take it.
5. **Contexts.** Keep iff (a) both produced it (name-match), or (b) Gemini produced it, or
   (c) it matches a leaf or endpoint name anywhere in the run's merged vocabulary.
   DeepSeek-only, run-novel contexts are dropped (`reason: drop:ds-only-novel`).
6. **Container stem check.** `isContainerName` matches
   `^(income statement|cash flow statement|balance sheet|financial statements?)\b` and
   the exact list from the probe, so `cash flow statement mechanics` is caught.
7. **Coverage.** A KLP may be covered by ONE leaf or by ONE OR MORE edges (replaces the
   probe's "exactly once"; Part F showed two independent models correctly splitting one
   KLP into two edges).

### 3. Adjudicator call — qwen3.7-flash, batched, one call per card, often zero

Only `name_conflict`, `kind_conflict` and `edge_conflict` items reach it. The prompt shows,
per item, the KLP text and `kind` and the two candidates labelled A/B with **Gemini's side
randomised** per item (seeded, recorded) so the judge cannot learn a slot. It answers two
closed questions per item, never "are both wrong":

- `sameConcept: boolean` — if true, the rule (shorter wins) decides; the judge does not
  pick a name.
- else `prefer: 'A' | 'B'`, `strength: 'clear' | 'slight'`.

**Weighting is applied in TypeScript, not by the judge:** Gemini wins unless the verdict is
DeepSeek + `clear` (`judge:ds-clear`). If the judge call fails, the item resolves to Gemini
(`fallback:gemini`) and the failure is counted — never silently.

### 4. Probe flag `--dual`

`probe-topic-minting.ts --dual` mints each card with `deepseek-v4-flash` and
`gemini-3.6-flash` (two direct pools, one per provider), reconciles, adjudicates, and writes
`{ term, deepseek, gemini, merged, judgeCalls }` per card to `--json`. `--cards <id,id,...>`
selects specific cards so a spread across sets can be run in one invocation. Same pacing,
same bounded retries, same stderr progress as today.

### 5. Measurement

The dual run prints, for merged vs each raw model: self-duplicates (should be 0),
kind-consistent shapes (%), mean name length (words), share of names reached by ≥2 cards,
container stems, and judge calls per card. When the owner's gold labels exist for a card
set, `scripts/score-topic-gold.ts` (later) scores merged / DeepSeek / Gemini against them.
Every merged decision carries its `reason`, so a wrong rule is visible as a wrong reason.

### 6. Cost

Per card: 2 mint calls + ~0.4 judge calls, ~4k tokens. gemini-3.6-flash's 20/day/key is the
binding quota; DeepSeek and Qwen are uncapped.

## Out of scope

Writing `Klt`/`KlpTopic`/`KltRelation`; reconciling against the 113 existing concepts; the
"edges affect both endpoint topics at rank 2" mastery question (recorded in
`topic-minting-engine-state` memory and Part F); fixing KLPs that carry reasoning on a
memorisation point (an authoring issue, noted for the re-authoring pass).

## Build order

1. `topic-reconcile.ts` with tests: `normalizeName`, `EXPECTED_SHAPE` covers `KLP_KINDS`,
   self-dup purge, each shape rule, shorter-wins and tie, overlap threshold with the head-noun
   guard (the `effective/marginal tax rate` pair must NOT merge), context rules, coverage.
2. Prompt rule 8 in the probe; `--dual`, `--cards`, judge call, JSON output.
3. Run: the five accounting cards; then a spread of LBO (authored) + M&A (3 legacy) cards.
4. Grid artifact v3: DeepSeek | Gemini | merged (with reasons), both card sets.
