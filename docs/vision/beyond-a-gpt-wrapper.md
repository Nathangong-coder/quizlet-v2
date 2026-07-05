# Beyond a GPT Wrapper — Making this Quizlet Transformative

_Working notes, 2026-07-04. The premise: personalized learning is necessary but **not sufficient** to be more than "Quizlet with a Gemini button." This doc argues where the real, defensible transformation is and how to get there._

## The wrapper test

A GPT wrapper is any product whose value evaporates if you paste the same prompt into the model directly. To *not* be a wrapper, the product must own something the raw model can't reproduce:

1. **A proprietary data asset** the model doesn't have (your longitudinal learning history).
2. **A closed feedback loop** where using the product makes it measurably better for *you*.
3. **A workflow / interface** that changes behavior, not just answers questions.
4. **Distribution/social effects** the model has no access to.

The three planned features touch #1 and #2. The ideas below push harder on all four. **The moat is the memory graph + the loop, not the prompts.**

---

## Tier 1 — Deepen what's already planned (cheap, high leverage)

### 1. A real learner model, not just per-card confidence
Confidence-per-card is table stakes. The transformative asset is a **concept graph**: terms link to underlying concepts (WACC → cost of equity → CAPM → beta), and mastery propagates. Missing "levered beta" should raise suspicion about "WACC" *before* the user fails it. Gemini can *extract* the prerequisite graph from a set once; the app *owns and updates* it forever. **This is the thing ChatGPT structurally cannot do for you** — it has no persistent, structured picture of what you specifically know.

### 2. Diagnose *why* an answer was wrong, not just that it was
Grade the **error type**, not the score: conceptual gap vs. terminology slip vs. recall failure vs. "knew it, mis-explained." Store error types as first-class events. Now the plan can say "you don't have a WACC problem, you have a *mixing-up-book-vs-market-values* problem across 6 cards" — a diagnosis no single prompt produces because it requires cross-session aggregation the app owns.

### 3. Predict the next failure
With enough `StudyEvent` history, a simple model (even logistic regression on features: days-since-seen, confidence, error-type history) predicts P(fail tomorrow) per card. That powers *genuinely* smart scheduling and lets the app pre-empt: "you're about to lose WACC — 90 seconds now saves you." Prediction from owned longitudinal data is not something the raw model can do.

### 4. Interview simulation with an evolving interviewer
Not one-off Q&A. A persistent **AI interviewer persona** that remembers prior sessions, escalates difficulty, drills into hedges ("you said 'roughly' — give me the exact formula"), and adapts to *this* user's tells. The transcript history is the asset.

---

## Tier 2 — New surfaces that raw chat can't replicate

### 5. Set intelligence: the app understands the *material*, not just stores it
On import, run a one-time AI pass that: dedupes near-identical cards, flags factually wrong/outdated definitions, detects missing prerequisites ("you test WACC but never define cost of debt"), and clusters cards into a syllabus. The set becomes a **structured knowledge object**, not a flat list. This is authoring leverage a chatbot doesn't give you because it requires holding and mutating the whole corpus.

### 6. Generative practice that targets *your* confusion pair
When the model sees you repeatedly confuse enterprise value vs. equity value, it generates a **custom drill** built specifically around that confusion (side-by-side, adversarial distractors, a numeric example where the two diverge). Generic MC from the raw model can't do this — it lacks your confusion history.

### 7. "Explain like the interviewer will push back" mode
Beyond grading: an adversarial dialog that finds the weakest link in a spoken/typed answer and pushes there, ratcheting like a real MD would. Grade the *recovery*, not just the first answer.

### 8. Source-grounded truth
Let users attach authoritative sources (a textbook PDF, lecture notes, a filled model). Grade answers against **their** source of truth, not the model's priors — and cite the exact passage. This flips the trust problem: the app is grounded in the user's canon, which the raw model isn't. (Builds directly on the multimodal work.)

---

## Tier 3 — Moats (compounding, hard to copy)

### 9. The longitudinal record *is* the product
After 3 months, the app knows the user's learning velocity, forgetting curve shape, error-type fingerprint, and time-of-day performance. That dataset:
- makes every future session better (loop),
- is portable leverage (a shareable "readiness report" before a real interview),
- is **switching-cost gravity** — leaving means starting cognitively from zero.
Invest in making this record legible and valuable *to the user* (a dashboard of "here's how your DCF mastery matured"), not just fuel for prompts.

### 10. Peer + cohort signal
Once there are many users on overlapping material (finance interview prep is a *shared* canon), the app knows which concepts are universally hard, which distractors fool everyone, and how *this* user ranks. "You're in the 60th percentile on LBO mechanics; top-decile candidates drill X." Raw chat has zero cohort context. This is a data-network effect.

### 11. Readiness scoring / credentialing
Convert the record into a defensible "interview-ready" score per topic with evidence. If it correlates with real outcomes, it becomes a reason to use *this* app specifically — a credential a chatbot can't issue.

### 12. Content marketplace / creator loop
Verified high-quality sets (with the intelligence pass) from top users/TAs become distribution. Social + UGC effects are outside any model's reach.

---

## Anti-patterns to avoid

- **Prompt theater.** Adding more AI buttons ≠ transformation. Each AI touch must write to or read from the owned learner model, or it's just a wrapper feature.
- **Model-dependent magic.** Don't let core value hinge on one model's quirk; the moat is *your data + loop*, the model is swappable (the fallback chain already assumes this).
- **Ungrounded confidence.** Finance answers have right/wrong facts. Source-grounding (#8) and calibrated grading matter more than fluent prose.
- **Nagging without payoff.** Streaks/nudges only work if the targeted practice visibly moves the owned metric the user can see.

---

## The one-sentence thesis

> **Quizlet stores what you should know; ChatGPT can explain anything; this app is the only one that knows what *you* actually know, why you get *your* specific things wrong, and what to make you do next — and gets sharper every session you use it.**

Personalization is the entry point. The **owned longitudinal learner model + concept graph + closed practice loop** is the moat. Prioritize, in order: (1) the memory/loop foundation, (2) error-type diagnosis + concept graph (Tier 1 #1–2), (3) source-grounded truth (#8), (4) cohort signal once there's scale (#10).

## Suggested near-term bets (next after the 3 planned features)

1. **Error-type grading** — smallest change, biggest "it *understands* me" payoff. Extend the grading schema with an `errorType` enum + store it.
2. **Concept graph extraction** — one AI pass per set → a `Concept` table + card↔concept links; propagate mastery. Unlocks prediction, prerequisites, and smarter plans.
3. **A learner dashboard** the user *wants to look at* — mastery-over-time, forgetting curves, error fingerprint. Makes the owned data visible = felt value = retention.
