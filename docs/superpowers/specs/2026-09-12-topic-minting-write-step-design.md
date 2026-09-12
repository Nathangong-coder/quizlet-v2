# Topic minting — the write step (BUILD-QUEUE item 2, second half)

**Status:** built 2026-09-12 as `scripts/mint-topics.ts` over `src/lib/klt/mint-plan.ts`
(pure) and `src/lib/klt/mint-write.ts` (persistence). Plans by default; `--write` is the
gate, and the first real write is the owner's call. The `KltRelation` migration
(`20260912000000_klt_relation`) is written but NOT applied until that write.

**What it closes.** `author-klps` supersedes a card's `CardKlp` rows and never re-summarises,
so authored cards have ZERO live topic links (measured 2026-09-09: 258 links on authored
cards, 0 live). This step re-attaches every live KLP to the topic tree from a merged
proposal the owner has read, and gives edges a home.

## Input

A `--dual` JSON from `probe-topic-minting.ts` — the raw DeepSeek and Gemini proposals and
the reconciled `merged` proposal per card. The probe measures and never writes; this
script writes what a merge the operator has READ says. They are kept apart on purpose:
the merge rules changed three times on 2026-09-11 and every change was measured by
replaying stored proposals. A writer that re-minted on the fly would write a different
merge every time.

Before planning, the card's live KLPs are compared to the KLPs the proposal was minted
from (count and text). Any drift → the card is skipped with "re-mint first". A proposal
indexes KLPs by position; writing it onto a changed set would attach points to the wrong
concepts silently.

## What is written, per card

| Row | Rule |
| --- | --- |
| `Klt` | Upsert by `normalizedName` (global vocabulary) — exact-name reuse anywhere in the corpus. Within the SAME set, a containment match (`sameConceptByRule`) reuses the existing concept instead of minting a sibling (`income statement structure` → `income statement`). Across sets, exact only. A spelled-out abbreviation longer than `MAX_KLT_WORDS` contracts to its abbreviation (`earnings before interest and taxes` → `EBIT`) rather than being dropped. |
| `SetKltNode` | Via `applyPaths`: the parent becomes a root of the set if new; leaves and contexts go under it; a leaf already elsewhere in the set stays put. Edge ENDPOINTS get no placement and are reported `unplaced` — `retained earnings` belongs under the balance sheet, not under "three-statement linkages", and the tree-aware `placeUnparentedConcepts` pass is the honest way to put it there. |
| `KlpTopic` | Rank 1 for the leaf, rank 2 for each context. The card's live KLPs have their links REPLACED (delete + create), which makes a re-run idempotent. |
| `KltRelation` | NEW model. Typed, directed edge between concepts, BESIDE the tree, never in it. Provenance `minted`; `cardIds`/`klpIds`/`models` merged in on repeat, so the evidence count grows with every card that produces the same edge. A directed edge (`causes`, `requires`, `precedes`, `applies_within`) that would close a cycle with what is already stored is SKIPPED and reported. |
| `Card.kltStatus` | `ready`. |

Nothing about mastery is touched. `KlpTopic` is what `rollUpKltLinks` reads, so a
learner's existing evidence rolls up to the new topics on the next read — that is the point.

## Why `KltRelation` and not a DAG tree

Decided in BUILD-QUEUE item 3: the tree stays a tree (`SetKltNode` is unique per set and
concept) so mastery rollup counts every key point once; `depth`/`ancestorIds`/`layout.ts`
all assume one parent. The second parent a concept would have had — depreciation under the
income statement as well as the cash flow statement — is an `applies_within` edge here.
Edges render dashed, drive navigation and insight, and never enter rollup. Item 3's
projection of within-card `KlpRelation` edges through topic links will write rows with
provenance `projected` into the same table.

## Measured on the plan for the five accounting cards (no write)

- 5 cards, 46 concepts of which 30 new; 32 links (16 rank-1, 16 rank-2); 12 edges; 13
  unplaced endpoints.
- Reuse behaved: `balance sheet components` → existing `balance sheet`; `income statement
  structure` → `income statement`; `financial statements` reused as the parent.
- The name-length cap caught `earnings before interest and taxes` (5 words); the
  contraction rule was added and it now writes as `EBIT`.

## Out of scope

Placing endpoints (use `placeUnparentedConcepts`); projecting `KlpRelation` (item 3);
rendering `KltRelation` in `/concepts` and the KLP graph (item 3); re-minting on the fly.
