# KLT concept tree — design

**Date:** 2026-08-25
**Queue item:** `docs/superpowers/BUILD-QUEUE.md` #9, second iteration
**Status:** designed, not built
**Supersedes:** §10 of `2026-08-24-klt-topic-layer-design.md` ("No KLT hierarchy… that is the concept-graph bet `CLAUDE.md` defers"). This spec takes that bet, deliberately. It also supersedes that spec's §2 Decision 6 reading of `rank` as a breadth tier — see §2 below.

---

## 1. The problem

The KLT layer shipped with a three-rung ladder stored per key point: `rank` 1/2/3 meaning narrow / area / discipline. Measured against the live corpus (153 key points, 69 cards) after the first real generation run, the defect is unambiguous:

```
rank 1:  balance sheet(6)   dcf valuation(3)   beta(12)   net income(4)
rank 2:  balance sheet(12)  dcf valuation(8)   beta(6)    net income(7)
rank 3:  balance sheet(8)   dcf valuation(6)
```

**The same concept occupies three different depths at once**, depending on which card produced it. The cause is structural: each key point's ladder is proposed independently, so depth is a property of *that generation call* rather than of the concept.

At three rungs this is survivable. The user wants six to ten (`finance → technicals → accounting → statements → cash flow statement → liquidity → liquidity ratios → quick ratio`), and at that depth it is fatal:

- `MetricThresholds.masteryTopicRanks` is a **depth cutoff**. If depth means something different per card, the knob means something different per card.
- "Show me level 4" returns an incoherent mixture of disciplines and leaf concepts.
- Per-level mastery — the whole point of the request — aggregates over sets that are not comparable.

A second problem sits behind it: storing every rung per key point means ~8 rows and ~8 generated names *per key point*. At 153 key points that is ~1,200 rows and a large repeated generation cost for concepts that already exist.

---

## 2. Decisions

Taken with the user on 2026-08-25.

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | **The ladder is a property of the CONCEPT, not of the link.** `Klt` becomes a tree via `parentKltId`. | The only way depth can be globally consistent. `accounting` sits at one depth for every card and every account. |
| 2 | **A key point links to its LEAF concept only.** Ancestors are derived by walking up. | ~153 links instead of ~1,200, and per-level mastery becomes a subtree query rather than a generation. Directly answers the user's token-cost concern: reporting at every layer costs **zero** extra AI calls. |
| 3 | **`rank` returns to meaning CENTRALITY** (primary leaf vs secondary), not breadth. | Breadth now lives in the tree, so rank is free to mean what it originally did. This restores the user's original "all ranks count toward mastery" decision to the meaning they gave it under, and `masteryTopicRanks` keeps working unchanged. |
| 4 | **Two-phase generation.** Phase A names the label + leaf; Phase B places new leaves in the tree. | Naming a leaf from the KLP's own words is what the model is reliably good at. Deciding where it hangs is the compounding error, and it wants the whole tree in view — not one batch. Phase B runs only for genuinely new concepts, so it amortises toward zero. |
| 5 | **The top of a subject tree is SEEDED, either by the user or by the AI on request.** | The model reliably collapses middle rungs (§10.1). Anchoring the top removes the least reliable task rather than trying to prompt around it. NOT the hardcoded finance taxonomy rejected in the previous spec: this is per-user, optional, authored in the editor, and the AI-seeded path keeps the zero-setup property for anyone who does not want to author one. |
| 6 | **Depth is not uniform and is never padded.** Hard cap 8. | Forcing a rung count reproduces the padded-KLP failure the extraction prompt already warns against — the model will invent `statements → financial statements → statement analysis` to hit a target. |
| 7 | **Display depth is auto-selected, with manual override.** | The deepest level whose topics clear the learner's observation floor. Thin corpus shows broad topics; the view sharpens as evidence accumulates, instead of showing 60 leaf topics reading "not measured". |
| 8 | **A tree editor UI ships with the feature**, gated by a `KLT_EDITORS` allowlist. | The user chose a UI over an operator script. The gate reconciles it with the previous spec's Decision 8 ("users cannot edit the global vocabulary"): the tree is shared, so an unrestricted editor would let one account move everyone's mastery. |
| 9 | **Verification runs in both directions** — structural invariants in TypeScript, semantic audits by AI. | The user's requirement. Structural tests pass happily on a perfectly-shaped nonsense tree, so neither alone is sufficient. |
| 10 | **Depth is DISCOVERED, never demanded.** A shallow chain is accepted; a refinement pass deepens it later. | Asking for eight rungs produces eight, including invented filler that then becomes permanent structure. Branching factor tells us *where* a rung is missing; splitting an overloaded node is a clustering task the model is good at, unlike inventing a deep path from cold. Same principle as the concentration check that fixed prompt v3. |
| 11 | **`technicals` is one rung, a sibling of `behaviorals` / `market knowledge` / `brain teasers`.** | The user's correction. `core concepts` and `fundamentals` are *children* of technicals, not competing names for it — an error in the previous draft. |

---

## 3. Schema

```prisma
model Klt {
  id             String     @id @default(cuid())
  name           String
  normalizedName String     @unique
  parentKltId    String?
  parent         Klt?       @relation("KltTree", fields: [parentKltId], references: [id], onDelete: Restrict)
  children       Klt[]      @relation("KltTree")
  /// 0 at a subject root. Denormalized; `child.depth = parent.depth + 1` is a
  /// tested invariant, not an assumption.
  depth          Int        @default(0)
  /// Every ancestor id, root-first, EXCLUDING self.
  ///
  /// Denormalized so "everything under `accounting`" is one indexed array
  /// containment query rather than a recursive CTE — per-level mastery is read
  /// on every dashboard load, so it must be cheap. A structural test asserts it
  /// matches an actual parent walk, because a stale array silently changes
  /// which key points roll up where.
  ancestorIds    String[]
  createdAt      DateTime   @default(now())
  links          KlpTopic[]

  @@index([parentKltId])
  @@index([depth])
}

model KlpTopic {
  id    String  @id @default(cuid())
  klpId String
  kltId String
  /// Centrality, NOT breadth: 1 = the concept this point is chiefly about,
  /// 2 = a second concept it honestly also covers. Breadth comes from the tree.
  rank  Int
  klp   CardKlp @relation(fields: [klpId], references: [id], onDelete: Cascade)
  klt   Klt     @relation(fields: [kltId], references: [id], onDelete: Cascade)

  @@unique([klpId, kltId])
  @@index([kltId])
  @@index([klpId, rank])
}
```

`ancestorIds` needs a GIN index, added in the migration SQL by hand — Prisma does not express it.

**`onDelete: Restrict` is deliberate.** Prisma defaults an optional self-relation to `SetNull`, which would silently orphan an entire subtree on a delete — every key point beneath it would vanish from every rollup above it, with nothing raised. The editor refuses the delete too (§9), but the database is the guard that cannot be bypassed by a script or a future call site.

---

## 4. Pipeline

### 4.1 Phase A — label and leaf (prompt v4, replaces v3)

The existing per-batch call, minus the ladder. Per key point it returns:
- `label` — unchanged, 3–6 words, capped by `parseKltLabel`;
- `concepts` — **1–2 leaf concepts**, most central first. No paths, no ancestors.

**The leaf rule, stated in the prompt and enforced by review, not code:** a leaf must be a concept a *different card could also be about*. `quick ratio` passes. `quick ratio excludes inventory` is a restatement of the key point and fails. This is the guard against leaf proliferation, where every point mints its own leaf and nothing aggregates.

Names still go through `parseKltName` (≤4 words, ≤40 chars, dropped never truncated).

### 4.2 Phase B — placement (new prompt)

Runs for leaves that exist with `parentKltId: null` and are not themselves roots.

Input: the **entire current tree**, rendered compactly as indented paths, plus the list of unplaced leaf names. Output per leaf: a full path from a subject root down to it, e.g.

```
finance > accounting > financial statements > liquidity ratios > quick ratio
```

Rules in the prompt:
- **Reuse an existing node at every level it fits.** Only invent what is genuinely missing.
- Never invent a level to reach a target depth. Omit rather than pad.
- The root must be a subject (`finance`, `biology`, `modern history`).
- Max 8 levels.

TypeScript then reconciles: match each path segment against `normalizedName`, create only missing nodes, set `parentKltId`, `depth` and `ancestorIds`, and **refuse any path that would create a cycle** or exceed the depth cap.

**Why the whole tree fits in the prompt:** it is names only, one line per node. At 72 concepts today that is trivial; the `KLT_CANDIDATE_CAP` retrieval already built for Phase A applies here if it ever stops fitting.

### 4.3 Failure and status

`Klt.parentKltId: null` on a non-root **is** the pending state — no extra status column. A failed placement leaves the leaf unparented; it still holds its key points and still reports mastery **as its own node**, it simply does not roll up yet. Degradation never fabricates a parent, for the same reason Spec 2a never fabricates a tag: a wrong parent is indistinguishable from a right one and moves real numbers.

---

## 5. Seeding the top of a subject

The model collapses middle rungs, so the tree gets its shape from an anchor rather than from a
deeper prompt. Two ways in, and a subject may use either.

### 5.1 User-authored

The tree editor (§9) doubles as the seeding surface: create a root, add children, drag to
re-parent. The user already knows their own taxonomy precisely — the worked example below came
from them in one message — so this is minutes of work, once per subject, and it is the highest-
quality anchor available.

### 5.2 AI-seeded, on request

A button in the editor: *"suggest a starting structure for this subject"*. One call, given the
subject name and the leaf concepts already extracted from the user's cards, returns a proposed
top **2–3 rungs only** — never leaves. The user accepts, edits, or discards it before anything is
written. Nothing is auto-applied: an unreviewed skeleton is the structure every later placement
inherits, so a wrong one is expensive and silent.

This keeps the zero-setup property for a learner who does not want to author a taxonomy, while
leaving the anchor a deliberate act rather than a side effect.

### 5.3 The worked example, from the user

```
finance
├── technicals
│   ├── accounting
│   │   └── financial statements
│   │       ├── cash flow statement
│   │       │   └── operating activities
│   │       │       └── non-cash charges
│   │       │           └── depreciation add-back
│   │       ├── balance sheet
│   │       │   └── liquidity
│   │       │       └── liquidity ratios
│   │       │           └── quick ratio
│   │       └── income statement
│   └── valuation
│       └── dcf
│           └── wacc
├── behaviorals
├── market knowledge
└── brain teasers
```

Both leaf paths are exactly 8 rungs, which is the depth cap. Seeding covers `finance → technicals
→ accounting`; Phase B places the leaf; §6 fills the middle.

---

## 6. Refinement — filling the middle

Placement produces short chains. Rather than prompt harder for depth, the tree reports where a
rung is **missing** and a separate pass inserts it.

**The signal is branching factor.** A node whose direct children exceed `MAX_BRANCHING` (7) is a
level that has absorbed distinctions it should have delegated: fifteen leaves hanging off
`cash flow statement` means `operating activities` and `non-cash charges` do not exist yet.

**The pass** takes one overloaded node and its children and asks for intermediate groupings —
never new leaves, never a re-root. TypeScript inserts the proposed nodes between parent and
children, recomputing `depth` and `ancestorIds` for the moved subtree in one transaction.

Grouping named siblings is a task models do well, and it is bounded: the failure mode is a poor
grouping of things that are already correctly under one parent, not a mis-rooted concept. Contrast
with cold-start path invention, where an error puts a concept in the wrong branch entirely.

**Refinement is proposed, never auto-applied**, for the same reason as §5.2: it rewrites structure
that mastery aggregates over.

---

## 7. Mastery rollup

Mastery at node *N* aggregates every key point linked to *N* **or to any descendant of *N***:

```
klpIds where KlpTopic.klt.id = N OR N = ANY(KlpTopic.klt.ancestorIds)
```

Those key point ids feed the existing `kltRowsToTopicRows` → `shapeTopicProfile` path unchanged, so knowledge, readiness and verbosity are computed by the same code as the category axis. **No second scoring implementation.**

`masteryTopicRanks` keeps its original meaning — how many of a key point's *leaf* concepts (rank 1, or 1 and 2) count. It is no longer a depth cutoff; depth is chosen by §8.

---

## 8. Display

**Auto-selected depth.** Compute, for each depth level, how many topics at that level clear the learner's `minObservations` floor. Show the **deepest** level where that count is at least `MIN_TOPICS_AT_DEPTH` (3). Fall back to the shallowest populated level when none qualifies.

This is a pure function of (topic counts per depth, floor) and is unit-tested as such — no AI, no heuristics in the component.

**Manual override:** a zoom in/out control moves one level either way and is URL-synced, matching how `HistoryScope` already works.

**Breadcrumb:** expanding a topic shows its ancestor path — `finance › accounting › financial statements › liquidity ratios › quick ratio`.

Every level stays queryable regardless of what is displayed.

---

## 9. Tree editor

A screen listing the tree, gated by `KLT_EDITORS` (comma-separated user ids). Not in the allowlist: the route 404s, same posture as any other owner check.

Operations: **re-parent**, **rename**, **merge**, **delete**.

- Re-parent recomputes `depth` and `ancestorIds` for the moved node **and its whole subtree**, in one transaction, and refuses cycles.
- Delete is refused while the node has children — orphaning a subtree is the silent failure this editor exists to fix.
- Merge re-points links and children, then deletes the emptied node.
- Every operation is `KLT_EDITORS`-gated **server-side**, not merely hidden in the UI.

**This is a global structure.** A re-parent moves every account's mastery, which is why the allowlist exists and why §10.2's audit output lands here rather than in an automatic job.

---

## 10. Verification

### 10.1 Structural invariants — TypeScript, in CI

Absolute, cheap, and run on every build:

| Invariant | Why it matters |
| --- | --- |
| `child.depth === parent.depth + 1`; roots are 0 | Depth is denormalized; drift silently changes which level a concept displays at |
| No node is its own ancestor | A cycle makes the rollup query non-terminating and mastery meaningless |
| Every node's chain terminates at a root | An orphaned mid-tree node's key points vanish from every rollup above it |
| `ancestorIds` equals an actual parent walk | The rollup reads the array, not the pointers; a stale array moves mastery with nothing to notice it |
| Depth never exceeds the cap | Catches a runaway chain before it reaches the UI |

Each is mutation-tested: break the invariant, confirm the test goes red, restore.

### 10.2 Semantic audits — AI, sampled, after a build

Structural tests pass happily on a perfectly-shaped nonsense tree. Both directions are needed because they catch different errors:

- **Downward** (from a node to its children): is every child a genuine *specialization*? Catches `liquidity ratios → depreciation`.
- **Upward** (from a leaf to its root): is every ancestor a genuine *generalization*? Catches a biology leaf rooted under `finance` — the most damaging error and, usefully, the most visible.

Output is a **report for a human**, never an automatic re-placement. Letting the model both make and grade the call, with nothing pinning it, allows a confidently wrong placement to persist or oscillate — and mastery moves each time it flips.

---

## 11. Migration

**Delete every `Klt` and `KlpTopic` row and re-run both phases.**

They are derived data holding nothing user-authored, the current 72 topics are flat with no parents to salvage, and the depth values recorded against them are exactly the inconsistency this spec removes. Converting would carry that inconsistency forward. Re-running costs one Phase A pass (~7 calls at the current corpus) plus one Phase B pass.

`CardKlp.label` is **kept** — it is unaffected by the tree and re-generating it would be waste.

**`KlpState`, `AnswerKlpResult` and `AnswerErrorTag` are untouched.** The §6 rule from the previous spec stands unchanged and its guards stay in place: this pipeline still never deletes or supersedes a `CardKlp`.

---

## 12. Known limits and risks

### 12.1 The model collapses middle rungs — the defining constraint

Asked to place `depreciation add-back`, a model reliably returns
`finance → accounting → cash flow statement → depreciation add-back`: four rungs, not eight. It
skips `technicals`, `financial statements`, `operating activities` and `non-cash charges` — not
because they are wrong, but because nothing makes them necessary. Models produce the shortest
defensible path.

Demonstrated the hard way: an earlier draft of this design used exactly that collapsed chain as
its own worked example, written by hand, and the user caught it. If it is the natural output for a
careful writer, it is the natural output for the model.

**Everything in §5 and §6 exists because of this.** Seeding anchors the top, refinement fills the
middle, and placement is asked only for the part it is reliable at. Prompting harder for depth is
not on the table — demanding a rung count produces filler, which then becomes permanent structure
every later placement inherits.

### 12.2 A wrong parent silently moves a subtree's mastery

The compounding error, and the reason `CLAUDE.md` deferred the concept graph. Mitigations: Phase B sees the whole tree; newly created intermediate nodes are logged for review; §10.2 audits both directions; §8 makes a correction one row rather than a regeneration. **A bad placement is cheap to fix and expensive to miss** — the audit is what converts the second into the first.

### 12.3 Middle rungs are the least stable

`technicals` is a study-culture term, not a taxonomy term; expect it to compete with `core concepts` and `fundamentals`. Leaves (anchored by the KLP's words) and roots (few subjects exist) are stable. The middle is where invented rungs cluster, and it is what the editor will mostly be used on.

### 12.4 One global tree spans every subject

Roots are subjects, so a biology leaf must never hang under `finance`. Placement is shown existing roots explicitly. Mis-rooting is the most visible failure mode, which is preferable to a subtle one.

### 12.5 Leaf proliferation

If every key point mints its own leaf, nothing aggregates and the tree is a list with extra steps. The §4.1 leaf rule is the guard; the **singleton-leaf rate** (leaves covering exactly one key point) is reported by the backfill alongside concentration and fragmentation.

### 12.6 A single-parent tree cannot express a concept with two homes

`depreciation` genuinely belongs under both the income statement and the cash flow statement. One
parent forces a choice, and whichever is picked, the other branch under-counts it.

Surfaced by the user's own example, so this corpus will hit it. Accepted anyway: a DAG makes every
rollup ambiguous — a key point reachable by two paths could be counted twice under a shared
ancestor — and every aggregation in §7 assumes a tree. Revisit only if mis-homing distorts real
numbers, not on principle.

### 12.7 Health checks must stay tier-aware

The v3 lesson: a global topic count is meaningless once topics form a hierarchy. Concentration is measured on **leaves**, fragmentation on **roots**. A check that fires on a healthy tree trains the operator to ignore it.

---

## 13. Build order

Three phases, each producing working software and taking its own implementation plan. The design
stays one document because the pieces only make sense together; the build splits because they do
not have to land together.

**Phase 1 — the substrate.** Schema and migration, Phase A/B generation, structural invariants,
subtree rollup, health metrics (branching factor, singleton leaves, concentration, fragmentation),
and enough display to keep `/profile/learner` honest: auto-selected depth plus a breadcrumb, no
zoom control. Ends with a real tree over the live corpus — shallow in the middle, and measurably
so rather than invisibly so.

**Phase 2 — the editor and seeding.** The tree screen behind `KLT_EDITORS`: view, re-parent,
rename, merge, delete, plus both seeding paths (§5). This is what turns a bad placement into a
one-row fix and lets the user impose the taxonomy they already hold. Depends on Phase 1.

**Phase 3 — refinement and audits.** Branching-factor-driven rung insertion (§6) and the
two-direction semantic audits (§10.2), both reporting proposals *into* the Phase 2 editor rather
than applying themselves. Depends on both.

Phase 1 alone is honest but shallow; Phase 2 makes it correctable; Phase 3 makes it improve on its
own. **Stopping after Phase 2 is a legitimate outcome** if the seeded tree turns out good enough —
Phase 3 is the one whose value is least certain in advance.

---

## 14. Out of scope

- **Multiple parents / a real graph.** A node has one parent. Cross-links are a genuinely different data structure and every rollup here assumes a tree.
- **Per-user trees or copy-on-write overrides.** The tree stays global; §9's allowlist is the answer to edit rights for now.
- **Automatic re-placement from audit findings** — §10.2.
- **Changing `CardKlp` in any way** beyond what already shipped. Labels stay, the proposition stays, the §6 mastery guards stay.
- **A public/browsable concept directory.** Related to item 6c, not this.
