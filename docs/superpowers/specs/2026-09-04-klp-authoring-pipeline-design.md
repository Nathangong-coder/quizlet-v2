# Stage 8 rebuild, Spec 2 — KLP engine: discrimination-tested authoring

**Date:** 2026-09-04
**Status:** approved, ready for an implementation plan
**Queue position:** second, after Spec 1 (built 2026-09-03). See `docs/superpowers/BUILD-QUEUE.md`
§ "Build order — RE-CUT 2026-09-03 (second pass)".
**Closes:** G1 (significance never spanned 1-10), G7. **Absorbs** queue item 10.
**Design of record it implements:** BUILD-QUEUE.md § "The KLP engine rebuild", which is the user's
own specification and is authoritative over this document wherever the two differ.

## Why this exists

Today's extraction batches 10 cards per call on the cheap `autocomplete` tier and asks for 1-5
propositions per card. The live corpus shows what that produces: 106 KLPs across 50 cards on
`Accounting - Knowledge` — a mode of 2 — and 92% of all weights are 4 or 5.

Neither number is a bug in the code. They are what you get when you ask a model to *write good
KLPs*, because "good" is a matter of taste and a model asked to self-assess centrality says
"central". The user's reframing is the whole spec:

> "You're not asking a model to write good KLPs, you're asking it to write KLPs and then testing
> whether they discriminate — which is a checkable property rather than a matter of taste."

A critique pass is a second opinion, and second opinions on taste do not converge. A discrimination
test has a numeric exit condition, so the loop terminates on evidence.

## 1. The pipeline, as calls

The seven authoring steps are not seven calls. Steps 1-3 are mutually informed — the wrong answers
must be written to target the drafted KLPs — and steps 4-5 are a loop. The scoring in step 4 and the
validation in step 7 are TypeScript, not AI.

| Call | Count | Produces | Task tier |
| --- | --- | --- | --- |
| **A — author** | 1 | Reference answer, draft KLPs, exactly 3 wrong answers | `author` (new) |
| **B — grade** | 4 | One call per candidate (reference + 3 wrong), each × every KLP | `author` |
| *(TypeScript)* | — | Separation score, per-KLP discrimination | — |
| **C — revise** | 0-2 | Revised KLPs, given the failing matrix. Each revision re-runs B. | `author` |
| **D — relate** | 1 | Relations by perturbation, order violation, substitution | `author` |
| *(TypeScript)* | — | Mechanical validation; computed weights | — |

**6 calls minimum, 16 worst case** (`1 + 4 + 2×(1+4) + 1`). Pilot cost: LBO (10 cards) ≈ 60-160
calls; `Accounting - Knowledge` (50 cards) ≈ 300-800.

**This is 2-3× the naive estimate, and the reason is §1.1.** Grading each candidate in its own call
is what the test's validity rests on; batching all four into one call would cost 3-6 calls per card
instead of 6-16. That knob is therefore a named constant, `GRADE_CANDIDATES_SEPARATELY`, defaulting
to `true` — see §1.1 for why flipping it is a real loss and not merely a cheaper mode.

### 1.1 Call B must not see call A's reasoning

This is the single detail that decides whether the test means anything. A model that has just
authored both the KLPs and the wrong answers will grade its own material generously, and a lenient
grader exits the loop early — producing loose KLPs that *look* tested, which is worse than
untested ones because the flag says they passed.

So call B receives only: the question, the reference answer, the KLP list, and ONE candidate answer.
It does not receive call A's rationale, its `cardType` judgment, or the fact that the candidate
answer was written to fail. Each candidate is graded in its own call, so the grader cannot calibrate
across them either — it never learns "this is the vague one".

There is a second, sharper reason the candidates are graded separately, and it is not about
leniency. A grader shown all four answers at once can **rank them against each other** instead of
judging each against the KLPs. It would then hand the reference high marks and the wrong answers low
ones *by comparison* — manufacturing separation that the KLPs did not earn. The separation score
would become an artifact of ranking, and the test would report success precisely when it was
measuring nothing. Isolation is what forces each verdict to be about the KLPs.

This is a real cost: four candidates means four grading calls, not one, and it is what takes the
per-card figure from 3-6 to 6-16. The mitigation is batching **within** a call — all KLPs for one
answer are graded together, which is what makes it 4 and not 4 × 7.

`GRADE_CANDIDATES_SEPARATELY` exists as a constant so the cheaper mode is one edit away, but it
defaults to `true` and flipping it costs the guarantee above. Anyone flipping it should know they
are trading the test's validity for roughly half the authoring spend.

### 1.2 A new `author` task

`AI_TASKS` (`src/lib/ai/model-routing.ts`) gains `author`. Authoring is judgment-heavy and runs
rarely; runtime grading is latency-sensitive and runs constantly. Sharing a task would force one
routing decision on both. A user can then pin authoring to a strong model without touching grading.

`AI_TASKS` is a plain const array read by `AiTaskRouting`; adding a member is mechanical, and the
routing UI enumerates it rather than hardcoding.

## 2. The separation score

Two conditions, both computed in TypeScript from call B's matrix. The AI produces verdicts; it never
computes the score. This mirrors the established rule that significance and mastery are computed in
TypeScript and the AI only supplies categorical judgments.

**Per KLP — does it discriminate?**
- It must PASS on the reference answer. A KLP the reference does not support was hallucinated past
  the artifact it was supposed to be derived from. Cut it.
- It must FAIL on at least one wrong answer. A KLP that fires identically across a strong and a weak
  answer carries no information. Cut or split it.

**Per card — do the answers separate?**

    separation = referenceScore − bestWrongScore

where a score is the fraction of KLPs the answer satisfies. This is the user's own criterion made
numeric: *"If your vague answer scores 6/7, your KLPs are too loose."* 6/7 is 0.857, so with a
reference at 1.0 that card's separation is 0.143 and it must loop.

`SEPARATION_FLOOR = 0.4`. Chosen so the user's stated failure case fails by a wide margin rather
than sitting on the boundary, and so a wrong answer may still legitimately earn up to ~60% — the
confident-but-wrong answer *should* get the structural points right; that is what makes it a good
adversary.

Both constants live in one module with the rest of the authoring thresholds, so tuning them is one
edit and a test.

**Exit conditions.** Loop while separation fails, capped at `MAX_REVISIONS = 2` (so at most 3
grading rounds). A card that still fails is written anyway with
`CardAuthoring.status = 'low_discrimination'` and surfaces in the staff view. It is not retried
silently and it is not dropped: dropping loses the work, silent retry burns the key pool, and
shipping it unflagged is the failure mode this whole spec exists to prevent.

## 3. Weight becomes blast radius — closing G1

Audit finding G1: `computeSignificance` weights `relevance` at 0.55 and reads `CardKlp.weight`, but
92% of live weights are 4-5, so no accuracy error can score below 5 and no conciseness error above
7. Significance mostly encodes *which dimension* an error was, not how bad it was.

The cause is asking an AI to rate centrality. After call D there is a dependency graph, so weight
becomes a **computed graph property**: the number of other KLPs that break if this one is false —
the blast radius the perturbation pass already measures. Leaves land low, root causes land high, and
the distribution spreads because the graph spreads it.

Mapping: `weight = clamp(1 + descendantCount, 1, 5)`, computed over the directed edges only
(`causes`, `requires`, `precedes`). Symmetric edges say nothing about dependency.

**Existing rows keep their AI-assigned weights.** KLPs are versioned and superseded rather than
overwritten, so a July error tag keeps pointing at the version that was actually asked, with the
weight that was actually used. History stays truthful; only new versions get computed weights.

## 4. Schema

Three new models. All are authoring artifacts, written once per authoring run and read per card.

```prisma
/// One authoring RUN for one card version. The audit trail for why a card's
/// KLPs are what they are.
model CardAuthoring {
  id              String   @id @default(cuid())
  cardId          String
  klpVersion      Int
  promptVersion   Int
  /// The strong-candidate answer the KLPs were derived from. Also improves
  /// short-answer grading, which today compares against `card.definition` —
  /// often a terse personal note — and can be shown to the learner after they
  /// answer.
  referenceAnswer String   @db.Text
  separationScore Float
  revisions       Int
  /// separated | low_discrimination | failed
  status          String
  createdAt       DateTime @default(now())

  @@index([cardId, createdAt])
}

/// A deliberately wrong answer, written to fail specific KLPs.
model AuthoringProbe {
  id          String @id @default(cuid())
  authoringId String
  /// confident_wrong | vague | memorized_template
  kind        String
  text        String @db.Text
  /// Fraction of KLPs this answer satisfied, 0-1.
  score       Float
  /// Per-KLP verdicts for THIS answer, keyed by the KLP's index within the
  /// card: { "0": "passed", "1": "omission", ... }.
  ///
  /// JSON, deliberately, and this is the one place in the codebase where that
  /// is the right call. Spec 2a's rule — a JSON blob cannot be indexed or
  /// FK'd — was written about ANSWER analysis, which Spec 3 aggregates across
  /// learners and cards. This matrix is authoring diagnostics: it is always
  /// read for exactly one card, in the staff view, to explain one separation
  /// score. It is never aggregated and never joined.
  verdicts    Json

  @@index([authoringId])
}

/// A link between two KLPs on the same card. Extracted here; SERVED in Spec 3.
model KlpRelation {
  id         String @id @default(cuid())
  fromKlpId  String
  toKlpId    String
  /// causes | requires | precedes | confused_with | applies_within | analogous_to
  type       String
  /// perturbation | order_violation | substitution
  provenance String
  rationale  String @db.Text
  /// The adversarial artifact that proved this edge informative: an answer
  /// getting BOTH endpoints right and the link wrong. Spec 3 serves this as
  /// the probe — proving the edge worth keeping manufactures the instrument
  /// that tests it, the same economy as generating a distractor from a named
  /// corruption.
  probe      String @db.Text
  createdAt  DateTime @default(now())

  @@unique([fromKlpId, toKlpId, type])
  @@index([fromKlpId])
  @@index([toKlpId])
}
```

`part_of` is deliberately absent from the relation types: it is the concept tree (`SetKltNode`) and
must not be duplicated here.

## 5. Relations

Extracted in this spec, **served** in Spec 3. Three techniques, none of which asks the model to
introspect about pedagogy:

- **Perturbation** — for each KLP, what else breaks if it is false? The asymmetry is the causal
  structure. **The perturbation must be a substantive counterfactual PREMISE, not a negation.** "K3
  is false" cannot be propagated; "depreciation is a cash charge" can. Ask for the counterfactual
  world, then re-derive inside it.
- **Order violation** — shuffle and ask which orderings are incoherent. Keep a rejection ONLY where
  the later point's derivation consumes the earlier one's output, and require a reason with each.
  Without that filter you collect stylistic ordering preferences, which are communication findings
  and belong to a dimension this spec does not touch.
- **Substitution** — which pairs get mistaken for each other? This yields `confused_with`, which is
  therefore a **predicted conflation**, on the same axis as the *observed* conflations
  `src/lib/metrics/misconceptions.ts` already derives from `(klpId, secondaryKlpId)`. That is the
  predicted-vs-observed provenance split, arriving early and free.

**Prune hard — it is the same test one level up.** Seven KLPs is 21 possible pairs and perhaps four
that matter. Keep an edge only where a learner could plausibly hold both endpoints and still miss
the link. Mechanically: for each candidate, generate an answer that gets both endpoints
demonstrably right and the link wrong. If none can be written, the edge is definitional, carries no
information, costs grading tokens, and is cut.

**Acyclicity is enforced on write** for the directed types (`causes`, `requires`, `precedes`). An AI
will happily emit X→Y and Y→X across two calls. `src/lib/klt/invariants.ts` was needed for a
strictly easier invariant, so this one gets the same treatment: a pure checker, tested, called
before persistence. `confused_with` and `analogous_to` are symmetric — stored under a canonical
endpoint ordering and exempt from the cycle check. `analogous_to` is cross-card and is NOT extracted
in this spec; it needs a corpus pass and is deferred.

## 6. The verdict vocabulary

The 13 labels land here as `src/lib/klp/verdicts.ts`, following the `CARD_KLP_STATUSES` / `AI_TASKS`
pattern, and are used by call B immediately:

`correct` · `partial` · `failed` · `omission` · `incomplete` · `contradicted` · `inversion` ·
`conflation` · `misapplication` · `factual_error` · `overgeneralization` · `unsupported_leap` ·
`fabrication`

**USE THE EXISTING SPELLINGS.** Five of these are members of `CORRUPTIONS`
(`src/lib/quiz/options.ts`), written onto every generated distractor as its provenance, persisted,
and guarded by a subset test in `tests/errors/taxonomy.test.ts`. A rename strands every existing
distractor row. `tests/errors/taxonomy.test.ts` must keep passing untouched.

Spec 5 later widens `AnswerKlpResult.status` to this vocabulary at runtime. This spec only
introduces the module and uses it for authoring, so nothing at runtime changes.

## 7. What changes in existing code

- `MAX_KLPS_PER_CARD`: 5 → 9. The range 5-9 is a **smell test, not a quota** — an atomic card
  genuinely has one point, and the discrimination test is authoritative over the range. Padding to
  reach five is exactly what the test catches, since a padded KLP fires identically on every answer.
- `KLP_BATCH_SIZE = 10` and `EXTRACT_KLPS_PROMPT` are **not deleted**. They serve the existing
  demand-driven path, which must keep working: new cards still need KLPs, and switching every card
  in the app to a 6-call pipeline is a cost change nobody asked for. Spec 4 owns that switch and
  deletes them.
- The new pipeline is invoked **explicitly**: `npm run author-klps -- --set <setId>`, following the
  `backfill-klts.ts` precedent. Resumable per card, so a failure at card 37 of 50 does not restart.
- `CardAuthoring` rows are the marker for which path produced a card's KLPs. There is never
  ambiguity about which grain a card is at.

## 8. Verification

Pure functions, tested directly and hardest: the separation score against the user's own worked
example (a vague answer at 6/7 must fail); per-KLP discrimination including the reference-fails case;
blast-radius weight over a hand-built graph including a leaf, a root, and a disconnected node; the
acyclicity checker in both directions, including the two-call X→Y / Y→X shape it exists to catch;
and the mechanical validators (compound "and", question restatement, count bounds).

The AI calls are mocked in tests. The pilot is the real verification: **LBO's 10 cards first**,
read in Spec 1's `/staff/klps` view, before `Accounting - Knowledge`'s 50 are re-authored — and that
set is chosen for the acceptance run precisely because its 106 existing KLPs make an old-versus-new
comparison possible on identical cards.

## 9. Out of scope, deliberately

- **Serving relation probes, storing relation verdicts, rendering the DAG.** Spec 3.
- **The full corpus walk and the self-healing loop.** Spec 4. This spec touches two sets.
- **Widening `AnswerKlpResult.status` at runtime.** Spec 5.
- **`analogous_to` relations.** Cross-card; needs a corpus pass.
- **Deleting the legacy extraction path.** Spec 4.
- **Any communication/clarity dimension work.** Deferred at the user's explicit instruction.
