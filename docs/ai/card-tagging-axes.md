# Tagging axes for cards, key points and questions

**Written 2026-09-09**, from a session that started as "how do concepts tie into KLPs" and
turned up a live defect (§0). This is a **findings record, not a plan**. Nothing here is
built. Items are numbered so they can be referred to by number later — the numbers are
stable, so a rejected axis keeps its number rather than being renumbered away.

---

## 0. The measurement that frames all of it (live DB, 2026-09-09)

```
live KLPs ..................................... 923  (across 200 cards)
  carrying a concept link (KlpTopic) ..........  231   25%

topic links total ............................. 509
  on LIVE KLPs ................................ 231
  on SUPERSEDED (dead) KLP versions ........... 278
  on authored cards ........................... 258   of which LIVE: 0

cards with KLP relations (authored) ...........  78
cards with live topic links ...................  54
overlap ....................................... ZERO

KlpRelation edges ............................. 477   cross-card: 0
  with BOTH endpoints concept-tagged .......... ZERO
```

**Authoring a card orphans its concept layer.** `author-klps` writes a new `klpVersion`,
superseding the old `CardKlp` rows and minting new ids; `KlpTopic` keys on `klpId`, so the
old links survive pointing at dead rows and the new KLPs get nothing — `author-klps` never
calls `summarizeKltsForCards`. The exact failure `summarize.ts`'s doc comment guards
against for `KlpState` happened to the topic layer, unguarded and unmeasured.

**Grain, by tree depth** (mean KLPs attached DIRECTLY to a node):

| depth | nodes | mean | max |
|---|---|---|---|
| 1 | 9 | 3.4 | 8 |
| 2 | 30 | 6.2 | 21 |
| 3 | 19 | 7.9 | 21 |
| 4 | 23 | **10.3** | 20 |
| 5 | 23 | 8.1 | 18 |
| 6 | 5 | 3.4 | 6 |

Leaves 6.1, internal nodes 6.5 — identical. **The tree performs no funneling.**
`income statement` sits at depth 4 collecting 19 KLPs by direct attachment.

**The grain rule** (user's, refined): attach every KLP to the **deepest node in the set's
tree that the point is honestly about**; broad nodes get their numbers by ROLLUP, never by
direct attachment. The count pyramid (~3-6 at a leaf, more at each level up) is the
**health check that tells you the rule is holding** — never a quota. Enforcing counts makes
the assigner invent concepts to hit them. Same relationship as the weight histogram to G1:
a measurement is the acceptance criterion, not a report on one.

**Corollary, non-obvious:** 923 KLPs over 65 leaves is 14/leaf at perfect distribution. To
reach 3-6 the tree needs ~150-300 leaves, 2-4x today's 113 concepts. A KLP with no honest
leaf must be able to **mint** one, or it settles onto a broad ancestor and re-flattens the
histogram. **Assignment and tree growth are one job, not two.**

---

## Part A — structural axes (what shape of thing is being asked)

### 1. Response mode — what the answer must DO

`recall | explain | procedure | compute | compare | apply`

**Grain: the QUESTION, not the card and not the KLP.** A card is usually mixed ("walk me
through a DCF" has a definitional point, a step-order point and a math point), so one
card-level tag is a lie about two-thirds of it. And the same KLP can legitimately be probed
by recall or by application — that is a property of the asking. Card-level = the multiset
of its questions' tags, free.

**Decision it changes:** recognition-vs-production diagnosis — "you can state it, you
cannot produce it" — which is already flagged as computable-today, highest-value, unbuilt.

**RISK, raised by the user and agreed:** suspiciously parallel to `CardKlp.kind`
(`definition|mechanism|causal|condition|quantitative|contrast|example`). Two enums naming
one distinction is this repo's recurring drift class.

**Required checks before it becomes a column:**

1. **Correlation against `kind`** on the existing 923 KLPs. If `kind` predicts response
   mode more than ~90% of the time, it is one axis with two names — do not ship it.
2. **Does it change a graded outcome?** If error rates are flat across all six values, the
   axis carries no information. The same standard the KLP pipeline holds itself to.
3. **Against REAL model output, never a fixture.** A unit test hand-writing `procedure`
   proves nothing — that is exactly what let the diagnostic grading prompt silently drop
   every tag while 2,948 tests passed.
4. The prompt must **name the closed vocabulary** verbatim, with a test pinning it.

### 2. Answer shape — what a correct answer looks like

`single_value | enumeration | ordered_sequence | argument`

**Earns its place because it changes CODE, not labels.** `single_value` needs no AI grader
at all. `enumeration` is set-coverage scoring, order-free. `ordered_sequence` makes
transposition a *specific, nameable* error. `argument` is the only one needing the full
rubric. Should also modulate `evidenceStrength` — a correct `single_value` is much weaker
evidence than a correct `argument`.

**Strongest structural candidate.** Lowest ambiguity, most downstream leverage.

### 3. Cognitive demand / Bloom — REJECTED

Collides with `abstraction` (`concrete | relational | dispositional`,
`src/lib/klp/abstraction.ts`), which already exists and already carries the
"a disposition is never a key point" rule. Adding a Bloom scale is a third name for the
same axis. **Do not build.** Note `abstraction` is currently an authoring-time hygiene
check only — it is NOT persisted; persisting it is a smaller and better move than inventing
a new scale.

---

## Part B — non-structural axes (more valuable, less obvious)

### 4. Contestedness — identity vs convention vs judgment

`identity | convention | judgment`

Is the point an arithmetic identity (`FCF = ...`), a house convention ("we use a 5-year
window"), or a judgment call ("a reasonable WACC is 8-10%")?

**Highest-value non-obvious tag on this list.** A wrong answer means something completely
different in each. An identity error is a real misconception. A convention mismatch may be
another bank's style, and marking it wrong teaches the learner to distrust the grader.
**This is the line between a misconception and a preference** — directly load-bearing for
the misconception library (queue item 11).

### 5. Salience — how much it actually matters

`core | common | niche | trivia`

**The user has already been building this by hand.** Live `CardCategory` rows include
`must-know`, `niche`, `classic`. For interview prep this is the tag a learner most wants
and the one AI is worst at guessing. **User-supplied**, later informed by cohort data.
Changes selection order in `rankCandidates`.

### 6. Answer budget — target seconds

An interview answer has a target duration. The rubric currently grades *conciseness against
nothing in particular*; this gives it a reference. Stage 4 voice mode needs it outright.

### 7. Modality requirement — needs the image vs happens to have one

`text_only | media_aided | media_required`

The `image` / `text` / `file` categories are doing this job badly today. **A hard filter,
not a label:** voice mode cannot serve `media_required` at all.

### 8. Decay class — sticky vs leaky

**DERIVED, never authored.** `KlpState.pKnown` + `observations` + `lastObservedAt` + the
forgetting curve already exist; cluster on them. Zero AI cost. **Defer** — needs more
observations than the corpus currently has.

### 9. Prerequisite depth — entry level

"A leaf you can start at" vs "presumes four other concepts." **Falls out of the concept DAG
for free** once Part C exists. Not a separate authoring job.

### 10. Diagnostic power — which misconception this card can DETECT

Not a tag on the card so much as a link from card to misconception. Lets a whole set be
checked for whether it can actually *detect* the common errors rather than only teach them.
Pairs with queue item 11.

---

## Part C — the concept graph (the reason the axes matter)

**Three graphs today, none connected to another:**

1. `KlpRelation` — a genuine DAG (`causes/requires/precedes/applies_within` directed,
   `confused_with/analogous_to` symmetric), cycle-pruned at authoring. **477 edges, all
   within ONE card. Zero cross-card, by construction** — the relate call only ever sees one
   card's KLPs.
2. `SetKltNode` — a per-set concept **TREE**, `@@unique([setId, kltId])` so exactly one
   parent per concept per set. 129 nodes, 6 of 11 sets, depths 0-7.
3. The deprecated global `Klt.parentKltId` tree, being dropped in Task 6.

**The bridge is `KlpTopic`, and it is 25% populated and 0% overlapped with graph 1.**

### The projection idea

Do NOT draw cross-card KLP edges (combinatorial, needs pairwise AI judgment). **Project the
within-card edges UP to concepts**: if KLP a (concept A) `requires` KLP b (concept B), that
is evidence for a concept-level `A requires B`. Aggregate across cards; the count of
**independent cards** producing the same edge is the confidence.

Why this beats asking an AI for a curriculum graph: every edge traces to a specific card and
a specific `probe`; nothing is invented; TypeScript computes the graph property from local
AI judgments — the same discipline as `weightFromSignals`.

**Run 2026-09-09: yielded ZERO edges**, because 0 of 477 relations have both endpoints
tagged. Not evidence against the idea — evidence for fixing §0 first. Re-running is free.

### Multi-parent (the depreciation case)

Depreciation belongs under both the cash flow statement and the income statement. **Not
expressible today** — one parent per (set, concept).

- **Option A, make the tree a DAG.** Rejected. `depth`/`ancestorIds` stop being single
  values, `rollUpKltLinks` double-counts any KLP reachable two ways, the canvas layout
  assumes one parent, node mastery becomes ambiguous. It corrupts the metrics substrate to
  fix a display problem.
- **Option B, keep the tree, add `KltRelation` beside it.** RECOMMENDED, and it is what the
  user described ("some dash or some way of connecting"). The user's own framing contains
  the tell: *"has a clear one in cash flow statement"* — there IS a primary parent, and the
  second link is a weaker, different relation. Depreciation lives under CFS; a
  `KltRelation` edge points at the income statement; it renders dashed; it drives navigation
  and insight and **never enters mastery rollup**. The vocabulary already exists —
  `applies_within` is literally "depreciation applies within the income statement."

**"Relations that only hold in specific moments/cards"** (the user's hardest observation)
falls out naturally: a projected edge carries `cardIds`. One card = contextual. Eight cards
= structural. A count, not a boolean.

---

## The filter that applies to every axis above

Each is a persisted string column with a closed vocabulary, so a later rename **strands
live rows** — the `CORRUPTIONS ⊂ ACCURACY_TYPES` lesson. Before any of them becomes a
column, name **the decision that changes**:

| # | axis | decision it changes | verdict |
|---|---|---|---|
| 2 | answer shape | how the grader works; `evidenceStrength` | strongest structural candidate |
| 4 | contestedness | whether an error is recorded at all | highest value overall |
| 5 | salience | selection order | user-supplied, immediately useful |
| 7 | modality requirement | whether voice mode can serve the card | hard filter |
| 6 | answer budget | the conciseness rubric; Stage 4 | needs Stage 4 |
| 1 | response mode | recognition-vs-production | **measure against `kind` first** |
| 8 | decay class | scheduling | derived; defer, needs data |
| 9 | prerequisite depth | ordering | free once Part C exists |
| 10 | diagnostic power | set coverage auditing | pairs with item 11 |
| 3 | Bloom | — | rejected, duplicates `abstraction` |

---

## Part D — first minting dry run, 2026-09-09

`scripts/probe-topic-minting.ts --set <id> --limit 6`, gemini-3.6-flash, 5 cards
proposed + 1 transient provider failure. Writes nothing. The set was
`Accounting - "Talking"` (100% authored).

**What passed, cleanly:**

- **RULE 3 (no container as a leaf): PASS.** Zero leaves named `income
  statement`, `cash flow statement`, `balance sheet`, `leverage`. Those hold
  19 / 20 / 15 / 21 KLPs in the live corpus today.
- **RULE 4 (settings at mechanism grain): PASS.** Contexts came back as
  `non-cash adjustments`, `financing cash flow`, `working capital changes`,
  `operating cash flow`, `investing cash flow`, `equity rollforward`,
  `net income reconciliation`. **This is exactly the owner's SBC / share
  repurchase correction, produced on the first run.**
- **23 of 26 leaves are novel** against the 113 existing concepts — the
  vocabulary genuinely had to grow, as §0 predicted.

**What overshot, and it is a DESIGN finding, not a prompt bug:**

**KLPs per leaf: mean 1.04, min 1, max 2.** The model did not fuse; it produced
one leaf per KLP. 26 leaves from 5 cards.

That is the *logically correct* consequence of the failure-grain rule as
written. **KLPs are already the unit of independent failure** — the grader
scores each one separately, which is the whole point of `AnswerKlpResult`. So
"one leaf per independently-failable thing" resolves to "one leaf per KLP", and
the topic layer degenerates into a renaming of the KLP layer.

**The correction: within-card fusion is the wrong measure of grain.
CROSS-CARD CONVERGENCE is.** A leaf earns its place when *several different
cards* route KLPs to it — `gross profit` recurs across a dozen cards; the KLP
"gross profit is revenue minus COGS" occurs once. Aggregation value comes from
convergence, not from compression inside one card. Five cards cannot measure
this at all (26/26 distinct is the expected result at n=5). **The next run needs
~30-50 cards and must report distinct-leaves / total-leaves.**

**Second finding: linkage KLPs became pseudo-concepts, and they are EDGES.**
The card "How do the three statements link together?" produced leaves named
`net income retained earnings linkage`, `net income operating cash flow link`,
`investing activities long-term asset link`, `financing activities balance sheet
link`, `ending cash balance reconciliation`. Those are relations phrased as
nouns. They are not nodes — they are precisely the `KltRelation` edges Part C
proposes (`net income -> retained earnings`, `working capital -> operating cash
flow`), arriving from a completely different direction and confirming the shape.

**So the prompt needs a seventh rule: a KLP whose content IS a link between two
concepts emits a RELATION, not a leaf.** That both fixes the pseudo-concepts and
gives the concept DAG its first real edges — from the one card type most likely
to produce them.

**Process note, recorded because it cost twelve minutes and real quota.** The
first version of the probe looped `while ((combo = nextCombo(pool)))`.
`nextCombo` is `selectAttemptOrder(pool)[0]`: it returns the best AVAILABLE
combo and never returns undefined while any combo is enabled, so every failure
that is not a daily-quota halt retried forever at full CPU. `author-klps` bounds
this with `MAX_COMBO_ATTEMPTS_PER_CARD = 3`; the probe now mirrors it. Also:
Node fully buffers stdout to a redirected file on Windows, so the runaway
produced ZERO output and was indistinguishable from a hang — progress now goes
to stderr.

---

## Part E - run 2: 30 cards, rule 7 live. The verdict is NEGATIVE, usefully.

`probe-topic-minting.ts --set <Accounting-Talking> --limit 30`, three Gemini models
rotating, **30 cards proposed, 0 failures**. Writes nothing.

### The two numbers that decide the algorithm

```
CONVERGENCE      104 distinct / 109 total leaves = 0.95   (1.00 = no convergence at all)
                 leaves reached from >=2 cards: 5
CROSS-CARD JOIN  6 / 66 relation endpoints = 9%
```

**Bottom-up blind minting does not converge.** 95% of leaves are single-use. Five
concepts out of 104 were reached by more than one card. A topic layer like that is a
renaming of the KLP layer with extra steps.

### The two runs bracket the problem, and neither end is right

| | vocabulary shown | convergence | failure mode |
| --- | --- | --- | --- |
| live system | yes, 150 candidates ranked by most-linked | far too much | everything collapses onto `income statement`, `leverage` |
| this probe | none (mint blind) | none | every card invents private names |

It is tempting to read this as "the answer is in the middle" and reach for a dial. **It
is not a dial.** Minting and reconciliation are two steps, this probe built only the
first, and it measured convergence BEFORE reconciling - so 0.95 is an **upper bound on
non-convergence**, not the real figure.

Naive token-overlap clustering (Jaccard >= 0.5 on non-filler tokens) moves it to **0.77,
and multi-card concepts from 5 to 12**, correctly merging `historical cost principle` /
`historical cost principle definition` and `mark-to-market accounting` / `mark to market
measurement`.

**But the same clustering merged `effective tax rate` with `marginal tax rate`, and
`non-cash expenses` with `non-deductible expenses`.** Those are different concepts a
learner can fail independently - exactly what the failure-grain rule forbids merging.
**So reconciliation cannot be token overlap.** It needs an embedding at a conservative
threshold, or cheap AI adjudication of candidate pairs only, and it must be biased
toward NOT merging.

### The finding that points at the fix

**The dangling endpoints are the canonical concepts.** The 60 unmatched relation
endpoints are not junk. By name, the most frequent are:

> `retained earnings` - `operating cash flow` - `net change in cash` - `cash flow
> statement` - `assets` - `enterprise value` - `equity value` - `goodwill impairment`

Those are precisely the recurring, cross-card, reusable concepts the leaf vocabulary
failed to produce. **Rule 7's edges independently discovered the node vocabulary that
rule 5's minting missed.**

So the next iteration is not a better minting prompt. It is a second pass:

1. Mint blind, per card, as now - keeps the ratchet off.
2. **Promote frequently-referenced relation endpoints into canonical leaves.** They are
   already named as standalone reusable concepts (rule 7 required it), and being
   referenced from several cards is exactly the convergence evidence a leaf needs.
3. Re-anchor each card's hyper-specific leaves onto that canonical set where honest,
   keeping a specific name only where the concept is genuinely independently failable.

That inverts today's dependency: leaves are primary and edges dangle off them. The
evidence says **edges should seed the node set**.

### Rule compliance is a MODEL property

```
gemini-3.1-flash-lite   cards=14  leaves=51  container-leaves=3  rels=15
gemini-3.5-flash        cards=10  leaves=34  container-leaves=0  rels=15
gemini-3.6-flash        cards= 6  leaves=24  container-leaves=0  rels= 3
```

RULE 3 failed in aggregate - `income statement`, `cash flow statement`, `balance sheet`
appeared as leaves. **Every one came from `gemini-3.1-flash-lite`**; the other two models
produced none across 16 cards, and run 1 (6 cards, -3.6-flash only) passed cleanly. The
aggregate FAIL is a cheap-model artifact, not a prompt failure.

This answers the owner's concern that the AI will not enforce the rule well. Some models
will. **The deterministic checks are therefore not a nice-to-have - they are the
instrument that decides which model may author topics**, the role the separation score
plays for KLPs.

Note also that -3.6-flash produced **0.5 relations per card against -3.5-flash's 1.5**.
The strongest model was the most conservative about edges. Whether that is precision or
timidity is unmeasured, and it now matters, because rule 7's edges are the proposed
source of the node vocabulary.

**RULE 4 (contexts at mechanism grain) PASSED on all 30 cards and all three models** - 46
distinct mechanisms, including `non-cash adjustments`, `retained earnings rollforward`,
`indirect cash flow method`, `equity rollforward`. Not one bare statement name. The
owner's SBC / share-repurchase correction holds under rotation and at scale.

### Process defects in this run, recorded

- **Two probe processes ran concurrently**, writing the same JSON and progress file at
  independent offsets - visible as whitespace padding, and as `results` lagging
  `progress`. A background task reported "killed" had left its `node` process alive.
  **A killed-task notification means the wrapper stopped, not the process.** Check by
  command line before restarting. That run's output was discarded rather than reported.
- **A `str.replace` patch silently did not match** and the script printed `patched`
  regardless, so run 2 shipped without its convergence and join-rate reporting; the
  numbers above were recomputed offline from `run.json`. The block is inserted now and
  the patch asserts. Same class as the fixture-shaped guard: **a mutation that did not
  apply looks exactly like one that did.**

---

## Part F - run 3: the SAME five cards through four models, 2026-09-11

`probe-topic-minting.ts --set <Accounting-Talking> --limit 5`, run four times with
`KLP_DIRECT_MODELS` pinned to one model each (`KLP_DIRECT_PROVIDER=deepseek` for the
fourth). 20 proposals, identical prompt, identical KLPs. Writes nothing. Full per-card,
per-model listing: `docs/ai/topic-minting-4x5-2026-09-11.md`.

Run 2 rotated three models across 30 DIFFERENT cards, so every per-model number in Part E
was confounded by which cards each model happened to draw. This run removes the
confound, and the first thing it does is overturn one of Part E's claims.

```
model                   leaves  leaves/card  edges  edges/card  contexts  container-leaves
gemini-3.6-flash          17       3.4        13      2.6         17          0
gemini-3.5-flash          19       3.8        11      2.2         16          0
gemini-3.1-flash-lite     25       5.0         8      1.6         13          3
deepseek-v4-flash         25       5.0         7      1.4         29          0
```

**CORRECTION to Part E: gemini-3.6-flash is not "the most conservative about edges".**
On its six run-2 cards it produced 0.5 edges per card; on these five it produced 2.6, the
MOST of any model. The run-2 figure was the cards, not the model. Per-model comparisons
are only meaningful on a fixed card set - which is what this run is.

### Where models agree and where they do not

**Agreement concentrates on NOUNS; disagreement concentrates on the leaf-or-edge decision.**

- "Give me more details on assets, liabilities, and equity": **4/4 models produced the
  identical four leaves** (`accounting equation`, `assets`, `liabilities`, `equity`), and
  two produced the identical parent and relation. When a card is about things, blind
  minting converges without being shown a vocabulary.
- "How do the three statements link together?" - the same six KLPs became **0 leaves + 6
  edges** (3.6-flash), **1 + 5** (3.5-flash), **5 + 1** (3.1-flash-lite), **5 + 1**
  (DeepSeek). One shared leaf name out of ten. When a card is about links, the models
  split on the one decision rule 7 exists to make, and the split is by model, not by KLP.

**`net income --precedes--> retained earnings` was emitted by all four models on BOTH cards
it appears in: 8 of 8.** That is the first edge with cross-model, cross-card confirmation,
and the shape of evidence a `KltRelation` row should require.

**Seventeen concept names were reached by all four models blind** (leaf, context or edge
endpoint, anywhere in the five cards): `non-cash adjustments`, `working capital changes`,
`net income`, `retained earnings`, `equity rollforward`, `operating cash flow`, `investing
cash flow`, `financing cash flow`, `accounting equation`, `assets`, `liabilities`, `equity`,
`capital expenditures`, `free cash flow`, `gross profit`, `operating expenses`, `non-cash
expense add-backs`. Cross-model agreement on a fixed card set is therefore a usable
INSTRUMENT for naming: a name four models reach independently is canonical; a name one
model reaches is that model's phrasing.

### Per-model character, read off the same five cards

- **gemini-3.5-flash** names closest to canonical plain nouns (`net income`, `gross
  profit`, `net change in cash`) and picks the best edge endpoints (`operating cash flow`
  where 3.6 wrote `cash flow statement`; `cash and cash equivalents` where 3.6 wrote
  `current assets`). Its failure is attaching by the NOUN MENTIONED rather than the claim:
  KLP 0 of the walkthrough ("the income statement captures profitability by netting
  expenses against revenue") went to `net income`, and the non-cash add-back KLP went to
  `depreciation`, which is the example, not the concept.
- **gemini-3.6-flash** is the most willing to emit edges, including the two best uses of
  the vocabulary in the run (`non-cash expenses --applies_within--> operating cash flow`;
  `net change in cash --confused_with--> free cash flow`, also found by 3.5). But its
  endpoints are weaker (`financing cash flow --applies_within--> debt`; `investing cash
  flow --applies_within--> long-term assets`) and its leaf names carry suffixes that
  defeat convergence - `income statement purpose`, `balance sheet snapshot concept`, `net
  change in cash calculation`, `fundamental accounting equation` against three models'
  `accounting equation`. It also failed one card to "high demand" three times running and
  needed a retry.
- **gemini-3.1-flash-lite** produced every container leaf again (3, all on one card), one
  schema failure, and one REVERSED `requires` edge (`free cash flow --requires-->
  operating cash flow` reads "OCF cannot be computed without FCF" under the direction
  convention) beside a correct one from the same KLP. Consistent with Part E: not a model
  that may author topics.
- **deepseek-v4-flash**: all five cards in about a minute, zero schema failures, zero
  container leaves, no daily cap. Three defects. (1) **It over-produces contexts** - 29
  against 13-17 - and most of the excess restates the KLP rather than naming a mechanism:
  `future economic benefits`, `external claims on assets`, `bottom-line derivation`,
  `operating profit derivation`. Rule 4 says "do not invent one"; it invents. (2) **It is
  the most timid on rule 7**: on the linkage card only 1 of 6 link-KLPs became an edge,
  and it minted the run-1 pseudo-concept shape again (`net income to operating cash flow`
  as a LEAF). (3) It ignored the spell-out rule (`ebit`, `ebitda`), which is a
  reconciliation cost, since the other three spelled them out.

### Two defects in the probe itself, found by having four answers to compare

- **Rule 6 ("exactly once") is wrong for a KLP that IS two links.** The A/L/E KLP
  "liabilities and equity together fund the acquisition of assets" was emitted as
  `liabilities --causes--> assets` AND `equity --causes--> assets` by two models
  independently, and that is the right reading. The rule should be leaf XOR one-or-more
  relations, and the coverage check should count a KLP covered by several edges as
  covered once.
- **The convergence number cannot be read off five cards, but AGREEMENT can.** Convergence
  (distinct/total leaves) needs 30-50 cards per model, which on the free tier is two to
  three days per Gemini model. DeepSeek has no daily cap and finished five cards in a
  minute, so the 30-50 card convergence run should be DeepSeek first, and Gemini only for
  the models that pass the deterministic checks.

### What the owner is doing with this run

The owner asked for the raw per-card list from every model to build their own sense of
what a good output is. That is the missing piece: the checks in TypeScript (containers,
coverage, mechanism-grain contexts, spell-out) are necessary and rule out one model, but
nothing here says whether a NAME is right. A human-labelled gold set on these five cards
turns the grid into precision/recall per model, the same "grade the graders first" move
the grading-engine design makes for misconceptions.

### Addendum, same day: qwen3.7-flash on the same five cards

The owner enabled the QwenCloud key (it had been 403 `AccessDenied.Unpurchased` since
2026-09-06). `qwen3.6-flash` was requested too and **cannot be measured**: DashScope drops
the JSON schema for the 3.6 family, so every reply fails Zod — details in
`docs/ai/model-performance.md`. `KLP_DIRECT_PROVIDER=qwen` is now wired; the probe was
re-run with `qwen3.7-flash` pinned. 5/5 cards, ~30 s each, zero schema failures, zero
container leaves.

```
model                   leaves  leaves/card  KLPs/leaf  edges  contexts  double-covered KLPs
qwen3.7-flash             26       5.2        1.19        8       2            7
```

**It is the only model that fuses inside a card — and the fusion runs the wrong way.**
`cash flow statement mechanics <- KLP 1, 2, 3` and `balance sheet structure <- KLP 4, 5`
are the containers rule 3 forbids, renamed with a suffix so the string check misses them.
A learner can know the accounting equation and not the snapshot idea; one leaf cannot
record that. So the first within-card fusion the probe has seen is a rule-2 violation,
not the convergence the grain rule wants — and it hides from `CONTAINERS` by one word.
The deterministic check needs a stem match (`^(income statement|cash flow statement|balance
sheet)\b`), not an exact one.

**Its edges point into its own fused leaf.** Five of the eight relations have `cash flow
statement mechanics` as the `to` endpoint - the leaf it just minted on the same card. An
edge from a KLP to a container that KLP already sits in joins nothing across cards; all
five dangle. Cross-card join rate 4 of 16 endpoints.

**It attaches a link-KLP to BOTH endpoint leaves.** On the linkage card, KLP 0 ("net
income flows into retained earnings") went to `net income` AND `retained earnings` as
rank-1 leaves, with no edge. That is the owner's "edges should affect both topics"
instinct, executed by a model - and it is the exact trap the recommendation warns about:
at rank 1 a failed link reads as two failed nouns.

**Suffixes on everything:** `gross profit calculation`, `EBIT definition`, `EBITDA
derivation`, `net income calculation`, `accounting equation structure`. Four models wrote
`gross profit`; Qwen is the one out, on every income-statement leaf. It also wrote
`EBIT`/`EBITDA` capitalised and unspelled.

**Contexts: 2 in five cards** - the opposite failure from DeepSeek's 29. Rule 4 was
essentially ignored. **Zero edges on three of five cards**, including the FCF-vs-net-change
contrast KLP that two Gemini models turned into `confused_with`.

Net: compliant on the checks that exist, and wrong on the two the checks do not cover
(fusion toward the container, self-referential edges). It is the model that most needs
the owner's gold labels to be judged, because the instruments in TypeScript pass it.

**Updated cross-model vocabulary (5 models):** eight names reached by all five -
`working capital changes`, `net income`, `retained earnings`, `assets`, `liabilities`,
`equity`, `capital expenditures`, `free cash flow`; ten more by four.
`net income --precedes--> retained earnings` is now 8 of 10 (Qwen's two misses are the
both-leaves reading above).

---

## Part G - the dual pipeline, run on 13 cards, 2026-09-11

Design: `docs/superpowers/specs/2026-09-11-dual-model-topic-minting-design.md`. Built as
`probe-topic-minting.ts --dual` over `src/lib/klp/topic-reconcile.ts` (pure) and
`topic-judge.ts`. Two runs: the five accounting cards again, and a SPREAD - five authored
LBO cards (an enumeration, a conditions list, two causal chains, a contrast) plus the three
M&A cards that have key points at all. Side-by-side grid, every merged cell with its
reason: https://claude.ai/code/artifact/61511ace-d1d0-48a9-abba-e8ac81820096.

```
                      kind-consistent  leaves  edges  contexts  self-dups  name-words  container-leaves
ACCOUNTING (5 cards)
  deepseek-v4-flash   100% (30/30)       18     12       16         7         2.59          3
  gemini-3.6-flash    100% (30/30)       18     12       12         4         2.33          0
  MERGED              100% (30/30)       16     14        9         0         2.25          3
SPREAD (8 cards)
  deepseek-v4-flash    94% (30/32)       20     12       16         0         3.55          0
  gemini-3.6-flash     91% (29/32)       22     10        8         0         3.00          0
  MERGED              100% (32/32)       18     14        8         0         3.29          0
judge: 10 calls over 13 cards (0.77/card), 27 items sent, 1 call failed (ECONNRESET -> 4 Gemini fallbacks)
```

**Rule 8 (kind sets the default shape) works on the number it was built for.** With the
kind printed as a hint and nothing reading it, Part F had the FCF `contrast` KLP as a leaf
in three of five models. With rule 8 in the prompt, both minters are 91-100%
kind-consistent on their own and the merge is 100%, mostly by `rule:edge-wins-by-kind`
(11 of 13 cards' splits settled without a call).

**The merge does what the rules say and the numbers move the right way:** self-dups 11 ->
0, DeepSeek's contexts 16 -> 9 (its novel restatements dropped), merged names shorter than
either side on the accounting cards (2.25 words). Cost was two mint calls plus 0.77 judge
calls per card.

**THE JUDGE FINDING, which decides whether the weighting exists: qwen3.7-flash said
"clear" on 18 of 19 preference verdicts, and preferred DeepSeek on 14 of 19.** The
Gemini weighting only bites on "slight", so it fired ONCE in 13 cards. As built, the judge
is unweighted and DeepSeek-leaning - the opposite of the owner's read of type conflicts.
Not tuned blind; it is printed on the grid beside every `judge:ds-clear` cell so the owner
can see whether those picks were right. Two of them were visibly not: `net income
--precedes--> cash flow statement` chosen over `--> operating cash flow` (a container as an
endpoint), and `income statement` as a leaf over `net income`.

**A rule-3 exception surfaced by the first card.** KLP 0 of the walkthrough DEFINES the
income statement. Rule 3 forbids a statement name as a leaf, and Gemini obeyed it by
attaching the point to `net income` - the noun mentioned, which is wrong. DeepSeek broke the
rule and attached it to `income statement`, which for a point ABOUT the statement is the
deepest honest node. Rule 3 was written for points about things that happen ON a
statement; a point that defines the statement is the one legitimate direct attachment a
container should get. The prompt does not yet say so.

**DeepSeek now produces container leaves it did not before** (3 on the accounting cards,
none in Part F). The only prompt change was rule 8 and a harder rule 3. Worth one re-run
before drawing a conclusion - one run cannot tell prompt effect from sampling.

**On the spread, Gemini's raw edges on the causal LBO card were bad** (`fixed interest
expense obligations --causes--> capital expenditures`), and because the judge call for that
card failed, all four fell through as `fallback:gemini`. "Gemini is right on type" held on
the accounting cards; it does not extend to edge CONTENT on causal-heavy cards, and a
fallback that trusts one side unconditionally lands whatever that side wrote.

**Two reconciler decisions made while building, recorded because the spec said otherwise:**
- Same-concept-by-rule is token CONTAINMENT (one name's tokens inside the other's, the
  smaller side at least two tokens), not Jaccard + head noun. `effective tax rate` /
  `marginal tax rate` share the head noun and would have merged; the test pins them apart.
- `confused_with` edges emitted in both directions from two KLPs of one card (the M&A
  stock-vs-asset card) are kept as two rows. Symmetric dedupe is a one-line change; it was
  not made because two KLPs producing the same edge is convergence evidence, not a duplicate.

### The authoring bench, same day

The owner asked how many cards still await key points and for Qwen as an AUTHOR. Census on
the live database: **91 cards have no KLPs (79 of the M&A set's 82), 122 carry only legacy
single-pass extraction, 78 are authored.** Three of the KLP-less M&A cards were authored
dry-run by four models through the real pipeline:
https://claude.ai/code/artifact/bb78a8e9-ebaf-44bd-b589-1bebf005f80a. Every metric is
explained on the page.

```
model              cards  KLPs/card  mean sep  min sep  reference  smoke  defects  rels/card  w4-5
gemini-3.6-flash    1/3     5.0        0.60     0.60      1.00      1/1      1        3.0      0%
gemini-3.5-flash    3/3     4.0        0.71     0.63      1.00      3/3      1        2.7     17%
deepseek-v4-flash   3/3     8.3        0.63     0.50      0.98      3/3      9        3.7     20%
qwen3.7-flash       3/3     5.3        0.47     0.40      0.88      2/3      0        2.3      6%
```

- **gemini-3.6-flash authored ONE card.** Every key ran out of daily quota - the minting
  runs earlier in the day had spent it, and "high demand" retries burned attempts on top.
  Its row is one card. The 20/day/model cap is now the binding constraint on ANY same-day
  comparison that includes a Gemini model.
- **DeepSeek writes the most and the least hygienic:** 8.3 KLPs per card against a target
  of 6, and 9 defects, seven of them `compound` (two claims joined by "and"). It is the
  finding from `authoring-and-grading-are-different-skills` again, now on M&A.
- **Qwen authors cleanly and separates worst:** zero defects, but min separation exactly at
  the 0.40 floor, one smoke failure (`accepts_weak` - its `vague` adversary scored 0.60
  against its own points), and reference scores of 0.75 and 0.90 on two cards, meaning it
  wrote points its own best answer did not satisfy (`failed`, `partial`). A set the good
  answer fails is a set that will fail learners for the author's mistake.
- **gemini-3.5-flash is the tightest**: 4 KLPs per card, highest separation, zero
  reference misses, one `abstraction_spread` defect.

Nothing here was persisted. The grid exists so the owner can read the actual points and
decide what "good" is; the numbers above are the pipeline's own checks, which are
necessary and not sufficient.

---

## Part H - the amended merge, replayed on the same 13 cards, 2026-09-11

The owner read Part G's grid and set four rules (spec amendment,
`2026-09-11-dual-model-topic-minting-design.md`): nothing DeepSeek adds is dropped for
being extra, Gemini only replaces same-type items; type priority edge > context > leaf
when the sides differ; the overly-broad check runs as a rule, with the statement WINNING
on a `definition` KLP; and the judge must be less sure. `--replay` re-merged the SAME raw
proposals, so every difference below is the rules, not the models.

```
                      kind-consistent  leaves  edges  contexts  self-dups  name-words  container-leaves
ACCOUNTING (5)  merged (Part G)  100%     16     14        9         0        2.25         3
                merged (Part H)  100%     16     14       13         0        2.32         0*
SPREAD (8)      merged (Part G)  100%     18     14        8         0        3.29         0
                merged (Part H)  100%     18     14       15         0        2.85         0
* two statement leaves survive on definition KLPs by rule:statement-definition, flagged, not counted
judge: 11 calls / 13 cards, 40 items, 0 failures on the final replay
```

**What the rules did.** Contexts went UP (9 -> 13, 8 -> 15): DeepSeek-only extras are
now confirmed by the judge instead of dropped by rule - 18 checked, 9 kept as distinct,
9 dropped as restatements, which is the count rule working with a filter on it. Container
leaves went 3 -> 0 without a judge, and the two that remain are the income-statement and
balance-sheet DEFINITION points, kept by `rule:statement-definition` - the exception the
owner named, now a rule with the mechanism edge beside it (`net income --precedes-->
operating cash flow`, `rule:avoid-container-endpoint`). Merged names are shorter than
either raw side on the spread (2.85 against 3.00 / 3.55).

**The judge's role shrank to what a rule cannot do**, which is the point: of 40 items, 11
were edge ALIGNMENT (which of DeepSeek's edges is Gemini's same link), 18 were extra
checks, and only 11 were name preferences - 4 "same concept", 7 preferences. DeepSeek was
preferred on 3, and all 3 were the LONGER name, so under "preferred AND shorter" Gemini
kept all 7. "Would the other be rejected outright" was answered no 11 of 11 times.

**Three weightings were measured, and the middle one is the owner's "slightly":**
- `clear`/`slight` (Part G): DeepSeek won 15 of 19 - the judge said "clear" on 18.
- `otherAcceptable` alone: DeepSeek won 0 of 11 - the judge never said unacceptable.
- `preferred AND (unacceptable OR shorter)`: DeepSeek needs two of the owner's priors,
  Gemini one. On this replay that is 0 of 7 for DeepSeek, because its preferred names
  were the long ones - which is the owner's own read of DeepSeek's naming.

**Two more rules came out of reading the merged M&A card**, both agreement rather than
difference, and both tested: when BOTH models emitted a leaf and an edge for a KLP, both
are kept (edge priority settles a difference, not an agreement); and when one side has
leaf + edge against the other's leaf only, that is 2 vs 1 - Gemini's leaf replaces the
same-type leaf and the edge stays as the extra.

**Still open, unchanged from Part G:** the owner's gold labels on the five accounting
cards. Every number above is a property of the merge; none says whether a name is right.

---

## Part I - third merge: KLP vocabulary first, same-type surplus compressed, 2026-09-11

The owner read the second merge and named four cells (spec amendment 2). Traced through
the JSON, two of the three removals were MY rule, not the judge: `financing cash flow`
(linkage card) and `operating cash flow` (cash flow statement card) were purged as
"self-duplicates" because they matched the model's own EDGE ENDPOINT - the owner's rule
was about a context matching the model's own LEAF. The third, `debt paydown` ->
`deleveraging`, was "shorter wins" overriding the key point's own words. The fourth was
the IRR card keeping two rival edges for one point.

Fixes, all as rules with tests: `klpFidelity` (share of a name's words present in the KLP
text) decides before shortness and before the judge; same-type items compress to
`min(nA, nB)` with fidelity choosing the survivors; self-dup is leaf-only. Replayed on the
same 13 raw proposals:

```
                          DS-sourced  Gemini-sourced  both  by-vocabulary  compressed  judge failures
second merge (Part H)         ~15          ~50         31       -              -            0
third merge  (Part I)          35           36         31       9             19            0
```

The four named cells now read: IRR [2] one edge (`operational underinvestment --causes-->
ebitda growth`, DeepSeek's, word for word from the point); CFS [2] one edge and the
`operating cash flow` context kept; linkage [4] `financing cash flow` kept (both models had
it); value creation [3] `debt paydown` by `rule:klp-vocabulary`.

**An authoring finding the owner raised on the value-creation card, recorded for the
re-authoring pass (queue item 4):** an ENUMERATION card ("what are the main sources of
value creation in an LBO (5)?") should carry the five enumerated items as knowledge-grain
KLPs, each optionally with a mechanism or causal point attached - not a set of
mechanism/causal statements with the enumeration dissolved into them. Today's KLPs on that
card are the dissolved form, which is why its topic proposals read as a list of processes
rather than a list of sources. This is a prompt rule for `AUTHOR_KLPS_PROMPT`, not for
minting.
