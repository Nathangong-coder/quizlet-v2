# KLT: per-set structure over a global vocabulary — design

**Date:** 2026-08-25
**Queue item:** `docs/superpowers/BUILD-QUEUE.md` #9, third iteration
**Status:** designed, not built
**Supersedes** parts of `2026-08-25-klt-concept-tree-design.md`: Decision 4 (one global tree), Decision 8 (`KLT_EDITORS` allowlist), §3's placement of `parentKltId`/`depth`/`ancestorIds` on `Klt`, and §9's global editor. Everything else in that spec — the two-phase generation, the depth cap, the never-fabricate rules, the §6 mastery-safety guarantee — stands unchanged.

---

## 1. Why this changes

The owner asked for the tree editor to be available to **anyone who owns a set**, reached **from that set**, so that permissions can later be shared per set.

That collides with a decision they took earlier and deliberately:

> *"Make KLTs global — make KLPs global as well… Will help if i later implement like a leaderboard/comparison for users on sets/KLPs."*

A global structure editable by every set owner is not safe: one person re-parenting `financial statements` moves every other learner's topic mastery, with no undo and no audit trail. That is precisely what `KLT_EDITORS` existed to prevent. But a per-set structure, done naively, destroys the comparability the global vocabulary was chosen for.

**Measured on the live corpus (2026-08-25), which is what makes the resolution cheap:**

```
63 linked concepts — shared by >1 USER: 0 · shared by >1 SET: 0
28 interior concepts (structural rungs: finance, accounting, financial statements…)
6 sets, 8 users
```

Every **leaf** concept already belongs to exactly one set. The only thing genuinely shared is **structure** — and structure is exactly what a set owner wants to edit. So the two concerns were never really competing over the same data; they were tangled in one table.

---

## 2. The resolution

**Split the vocabulary from the structure.**

- `Klt` remains a **globally-unique concept registry**: a name, and nothing about where it sits. "WACC" is one row for the whole install, so cross-user comparison and a future leaderboard keep working.
- **Where a concept sits becomes per-set.** A new table records, for one set, a concept's parent, depth and ancestors. Each set owns its own hierarchy over shared names.

A learner with three finance sets therefore has three structures over one vocabulary. Rolling `accounting` up across them is the union of each set's `accounting` subtree — coherent, because the *name* is the same node everywhere.

### Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | **`Klt` keeps global `normalizedName` uniqueness and loses `parentKltId`, `depth`, `ancestorIds`.** | The registry is the comparable thing. Structure is not comparable across sets and never was — 0 concepts are shared by more than one set today. |
| 2 | **New `SetKltNode`: one row per (set, concept), carrying `parentKltId`, `depth`, `ancestorIds`.** | Structure becomes owned by the set that has to live with it. |
| 3 | **The editor moves to `/sets/[id]/concepts`, gated by SET OWNERSHIP.** `KLT_EDITORS` is deleted. | The owner's request. Ownership is a real boundary the app already enforces everywhere; an env allowlist was a stand-in for the absence of one. |
| 4 | **Every edit affects one set only.** | Removes the entire blast-radius problem that motivated the allowlist. A future permission share is then per set, which is the shape the owner asked for. |
| 5 | **Placement, seeding and health checks all become per-set.** | They operate on structure, and structure is now per-set. Phase B places a set's concepts within that set's tree, seeing only that tree. |
| 6 | **The mastery-safety guarantee is unchanged.** No path may delete or supersede a `CardKlp`, or touch `KlpState`/`AnswerKlpResult`. | `AnswerKlpResult.klp` is `onDelete: Cascade`; deleting a `CardKlp` destroys answer history irrecoverably. This survived two phases and survives this one. |
| 7 | **Rebuild rather than migrate the structure.** Keep `Klt` rows and `CardKlp.label`; re-derive every edge per set. | The existing edges encode one global hierarchy; splitting it per set by inference would guess. Re-deriving costs one backfill run and is honest. |

---

## 3. Schema

```prisma
/// A concept NAME. Globally unique, deliberately: "WACC" is one node for every
/// learner, which is what makes cross-user comparison possible. Carries NO
/// structure — where a concept sits is a property of the set, not the concept.
model Klt {
  id             String        @id @default(cuid())
  name           String
  normalizedName String        @unique
  createdAt      DateTime      @default(now())
  links          KlpTopic[]
  nodes          SetKltNode[]
}

/// Where one concept sits in ONE set's hierarchy.
///
/// The same concept may sit at different depths under different parents in
/// different sets, and that is correct — a finance deck and a biology deck
/// have no reason to agree about where `growth` belongs. Editing here affects
/// exactly one set, which is what makes the editor safe to hand to any owner.
model SetKltNode {
  id          String       @id @default(cuid())
  setId       String
  kltId       String
  parentKltId String?
  /// 0 at a root WITHIN THIS SET. Denormalized; a tested invariant.
  depth       Int          @default(0)
  /// Ancestor Klt ids, root-first, EXCLUDING self, within this set.
  ancestorIds String[]
  set         Set          @relation(fields: [setId], references: [id], onDelete: Cascade)
  klt         Klt          @relation(fields: [kltId], references: [id], onDelete: Cascade)

  @@unique([setId, kltId])
  @@index([setId, parentKltId])
  @@index([setId, depth])
}
```

`ancestorIds` needs a GIN index, added by hand in the migration as before.

**`parentKltId` is a Klt id, not a `SetKltNode` id.** Within a set the pair is unique, so a Klt id identifies the parent unambiguously and the rollup can compare ids across sets without a join. **No FK is declared on it** — a self-referencing FK would have to point at `Klt`, which would wrongly permit a parent that has no node in this set. The invariant checker enforces that instead, and gains a violation kind for it.

**Deleting a set cascades its structure away** and touches no vocabulary, no key points and no mastery.

---

## 4. What changes in the pipeline

- **Phase A (naming leaf concepts) is unchanged.** It produces `Klt` rows and `KlpTopic` links, neither of which moves.
- **Phase B (placement) becomes per-set.** It resolves the unplaced concepts of ONE set against THAT set's tree, and writes `SetKltNode` rows. A concept unplaced in set A may already be placed in set B; those are independent.
- **Seeding becomes per-set**, and its "suggest a skeleton" call sees only that set's concepts.
- **Rollup becomes per-set, then unions.** For a scope spanning several sets, resolve each set's subtree for a concept and union the key points. `shapeTopicProfile` still scores, unchanged — no second scoring implementation.
- **Health checks and invariants run per set**, and the invariant set gains: *a node's `parentKltId` must itself have a `SetKltNode` in the same set.*

---

## 5. Migration

1. Create `SetKltNode`; drop `parentKltId`, `depth`, `ancestorIds` from `Klt`.
2. **Keep** all `Klt` rows, all `KlpTopic` links, and all `CardKlp.label` values — the vocabulary and the labels are unaffected.
3. Re-run placement per set to rebuild the edges.

`KlpState` and `AnswerKlpResult` are untouched, as in every prior phase, and that must be verified against real rows after the rebuild.

---

## 6. Known limits

**6.1 The same structure gets rebuilt in every set.** Two finance decks each derive their own `finance > accounting > financial statements`. That is more AI calls than one shared tree, and the two may disagree. Accepted: they were already disjoint in practice, and a set owner correcting their own hierarchy is worth more than a shared one nobody may edit.

**6.2 Cross-set rollup is a union, not a consensus.** If set A files `growth` under `valuation` and set B under `strategy`, a learner spanning both sees `growth` mastery aggregated across both placements. The *concept* is the same node — which is what comparison needs — but the *path* to it differs. This is the honest consequence of §2 and is not a bug.

**6.3 A leaderboard compares concepts, not trees.** Comparability lives entirely in `Klt.normalizedName`. Any future leaderboard must aggregate on the concept, never on a path.

**6.4 Interior rungs now have no links.** A `SetKltNode` for `accounting` may exist with no `KlpTopic` beneath it in that set if its descendants were removed. Health checks should surface these as prunable rather than treat them as errors.

---

## 7. Out of scope

- **Sharing permissions themselves.** This spec makes the editor set-scoped so that permissions *can* be added; it does not add them. Set sharing is queue item 6c.
- **Reconciling two sets that disagree about a concept's parent** — §6.2 accepts the divergence.
- **Phase 3** (branching-factor refinement, AI semantic audits) remains unbuilt and is unaffected by this change.
