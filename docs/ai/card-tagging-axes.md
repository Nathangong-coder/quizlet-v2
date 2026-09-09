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
