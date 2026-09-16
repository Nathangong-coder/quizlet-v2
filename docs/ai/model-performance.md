# Model performance

**A running record of which models and configurations can actually do this
app's work, measured rather than assumed.**

Last run: 2026-09-15 (`npm run bench-models`).

---

## Why this exists

Every artifact this engine produces is **persisted and then used as evidence**.
A key point becomes what a distractor is corrupted from; a grading verdict
becomes what a learner's mastery is computed from; an error tag becomes a
misconception the profile will later act on. A weak model here does not give a
worse answer — it writes a **wrong fact into someone's learning history**, where
nothing downstream can tell it apart from a right one.

So the question "is this model good enough" cannot be answered from a
leaderboard. The property that matters is **whether it holds a nested
structured-output contract while still making a correct judgment**, and no
public benchmark measures that.

Two measured examples of why not:

- `gemini-2.5-flash` returns perfectly good prose and **cannot satisfy the
  authoring schema at all.**
- `liquid/lfm-2.5-2.6b:free` returns immaculate, schema-valid JSON and, on 1 run
  in 3, **could not tell a correct answer from the literal string "IDK".**

A shape-only check passes the second one. That is the failure mode this
document exists to catch.

---

## Method

### The task

Every run grades the same two answers against real key points from the live
corpus:

| Question | Answer given |
| --- | --- |
| 0 | the key point's text, verbatim — unambiguously correct |
| 1 | `"IDK"` — unambiguously vacuous |

### The pass criterion is substantive, not structural

A run passes only if **all three** hold:

1. It returns one grade per question ref.
2. Each grade carries exactly one key-point verdict.
3. Question 0 is `passed` **and** question 1 is `failed`.

Well-formed JSON that fails (3) is a **failure**. That is the whole point.

### Harness

| Script | What it answers |
| --- | --- |
| `npm run probe-models` | Does model X hold the grading contract? Any provider, via `PROBE_PROVIDER` / `PROBE_KEY_ENV` / `PROBE_BASE_URL`. |
| `scripts/probe-grading-matrix.ts` | How do reasoning effort and provider strict mode interact, on one model? |
| `scripts/probe-diagnostic-ai.ts` | Does a full 12-question diagnostic hold together end to end? |
| `scripts/probe-diagnostic-writes.ts` | Does the write path survive real Postgres? (no AI) |

`probe-grading-matrix.ts` calls the provider **directly rather than through the
AI SDK**, and that is deliberate — see "Instrumentation traps" below.

---

## Results — 2026-09-06

### Google (policed by `GOOGLE_APPROVED_MODELS`)

| Model | Verdict | Evidence |
| --- | --- | --- |
| `gemini-3.1-flash-lite` | **PASS — added to allowlist** | 300 output tokens, 1.5s. Cheapest and fastest measured. |
| `gemini-3.6-flash` | in allowlist | The default. See the degeneracy note below. |
| `gemini-3.5-flash`, `gemini-3.5-flash-lite` | in allowlist | |
| `gemini-3.4-flash` | **DOES NOT EXIST** | `generateContent` 404s. Requested by name; asking the API settled it. |
| `gemini-3.7-flash` | **rejected (provisional)** | 4,185 output tokens on a probe `3.1-flash-lite` answered in 300, and hit the ceiling with `finishReason: length`. A re-test at a larger cap was inconclusive ("high demand"). |
| `gemini-3.8-flash` | untested | "high demand" on every attempt. |
| `gemma-4-31b-it`, `gemma-4-26b-a4b-it` | **cannot hold the contract** | "No object generated: could not parse the response." Gemma instruction-tuned models cannot be grading backups however cheap. |
| `gemini-2.5-flash` | rejected (earlier) | Failed the authoring schema outright during the KLP pilot. |

### OpenRouter free tier

Only **3 of 430** OpenRouter models advertise `structured_outputs` *and* are
free. All three were tested.

| Model | Passed | Latency | Output tokens |
| --- | --- | --- | --- |
| `nvidia/nemotron-3-super-120b-a12b:free` | **3 / 3** | 12.2–16.6s | ~1,500 |
| `liquid/lfm-2.5-2.6b:free` | **2 / 3** | 12.9–13.9s | ~3,550 |
| `dots-studio/dots-3-note-preview:free` | 0 / 1 | — | — |

`liquid` is marginally faster and **unreliable in the worst way** — its failure
was "did not separate a correct answer from IDK". Nemotron is the only free
model fit to go near grading, and its ~14s makes it a **background** model, not
a visible one.

`minimax/minimax-m3:free` supports `response_format` but **not**
`structured_outputs`, so it cannot hold the contract at all. `qwen/qwen3.7-flash`
likewise. (`qwen3.7-plus` and `-max` do support it; untested.)

### Authoring quality — separation score, 2026-09-07

The grading probe above asks whether a model can *judge*. This asks whether it
can *author*, and the answers differ.

One set (`Accounting - "Talking"`), same prompts, same pacing, same per-card
model pin, same TypeScript separation arithmetic. The only variable is the
model. `--direct` was made provider-aware (`KLP_DIRECT_PROVIDER`) specifically
so this runs on the production path rather than in a parallel harness that
would drift on exactly the thing being measured.

| Model | Cards | Mean separation | low_discrimination |
| --- | --- | --- | --- |
| `gemini-3.1-flash-lite` | 46 | **0.669** | **2%** |
| `gemini-3.5-flash-lite` | 44 | 0.616 | 16% |
| `gemini-3.5-flash` | 3 | 0.603 | 0% (n=3) |
| `deepseek-v4-flash` | 25 | **0.528** | **20%** |
| `gemini-3.6-flash` | 2 | 0.521 | 0% (n=2) |

**DeepSeek authors measurably worse than the cheapest Gemini**, and needed a
schema retry on roughly half its cards even after the fence fix below.

**This reverses its grading result** (5/5, 2.0s, deterministic), which is the
most useful finding here. Grading judges one stated proposition against one
answer. Authoring has to invent the propositions, invent three adversaries, and
keep them separable. **Competence on the first predicts very little about the
second** — and the cheapest model on the list is the best at it, which no
price-based reasoning would have produced.

**Trap 08 — a fence is not a capability limit.** The first DeepSeek run failed
every card with `NoObjectGeneratedError`. Not a budget or a capability problem:
`finishReason: 'stop'`, zero reasoning tokens, a *complete* object wrapped in a
` ```json ` fence. With `strict: false` the schema is advisory rather than
enforced by constrained decoding, so the model's formatting habits survive —
and they surface on the large authoring schema while the small grading schema
comes back clean. Unfenced in the DeepSeek fetch shim, and only when the
unwrapped text actually parses.

**A side effect worth more than the benchmark.** Writing a reference answer
makes the model work the problem, so it notices when the card is wrong. This run
raised **three substantive errors in the deck's own definitions** (a pre-tax vs
after-tax mislabel, HTM described as paying dividends, and a numerator/
denominator swap) and flagged them rather than silently rewriting the card.

### Qwen / DashScope — blocked, entitlement not credit

`QWENCLOUD_API_KEY` is VALID on
`https://dashscope-intl.aliyuncs.com/compatible-mode/v1` — it lists 165 models,
`qwen3.7-flash` among them. Every call to every model returns:

    403 AccessDenied.Unpurchased — "Access to model denied. Please make sure
    you are eligible for using the model."

Tested: `qwen3.7-flash`, `qwen3.8-flash`, `qwen3.7-flash-2026-07-15`,
`qwen3.7-plus`, `qwen3.8-27b`, `qwen-flash`, `qwen-plus`. All refused.

The account has no model entitlements. **This is a second, sharper example of
the listing-call trap already in CLAUDE.md**: the model is listed, and calling
it is still refused. `dashscope.aliyuncs.com` (mainland) rejects the key
outright with 401, so the region is right; the entitlement is not.

Untestable until the account is provisioned. Nothing in code can fix it.

**Retried 2026-09-07.** Identical: all four models, both the compatible-mode
and the Anthropic-shaped endpoint, still `403 AccessDenied.Unpurchased`. Qwen
therefore contributes nothing to ship against and is not in any rotation.

**LIVE 2026-09-11 — the owner enabled the key.** Same key, same intl endpoint,
no code change on the request path:

    qwen3.7-flash   OK    6.4s  (tiny structured call; ~30s per minting card)
    qwen3.7-plus    OK   20.9s
    qwen3.6-flash   FAIL  "No object generated: response did not match schema"
    qwen3.6-plus    FAIL  same

**The 3.6 family cannot hold the contract.** DashScope answers a `json_schema`
request for a 3.6 model by downgrading it to `json_object` (the 400 says so
verbatim: "'messages' must contain the word 'json' ... to use 'response_format'
of type 'json_object'"), so nothing constrains the shape and Zod rejects the
reply. That is the OpenRouter `structured_outputs` finding above in a new coat,
and it is a property of the endpoint, not of the prompt. Only `qwen3.7-*` may
enter a rotation. `KLP_DIRECT_PROVIDER=qwen` is wired (`direct-pool.ts`) and
`qwen3.7-flash` has been run through the topic-minting probe — see
`docs/ai/card-tagging-axes.md` Part F.

### OpenRouter paid — blocked

`deepseek/deepseek-v4-flash-0731`, `minimax/minimax-m3` and others advertise
structured outputs, but the account returns **"Insufficient credits. This
account never purchased credits."** Untested.

### DeepSeek direct — endpoint matters

| Endpoint | `json_schema`? |
| --- | --- |
| `/v1/chat/completions` | **No** — "This response_format type is unavailable now" |
| `/v1/responses` | **Yes** — via `text.format: { type, name, schema }` |

Both `deepseek-v4-flash` and `deepseek-v4-pro` **PASS** on `/responses`.

**Do not conclude "the platform cannot" from "this endpoint cannot."** That
error was taken at face value once in this project and led to a wrong
conclusion that a paid gateway was required.

### The reasoning x strict matrix — `deepseek-v4-flash`, 5 samples each

| Configuration | Pass | Latency | Output tokens | Reasoning |
| --- | --- | --- | --- | --- |
| reasoning on, strict off | 5/5 | 9.4s (6.1–13.0) | 1,168 | 943 |
| reasoning on, **strict ON** | 5/5 | **26.5s** (12.2–36.4) | **3,307** | **3,077** |
| **reasoning none**, strict off | 5/5 | 2.0s (2.0–2.1) | 296 | 0 |
| **reasoning none, strict ON** | 5/5 | **2.1s** (1.9–2.3) | 311 | 0 |

**WHY REASONING STAYS OFF ON DEEPSEEK — the standing decision, recorded 2026-09-12 at
the owner's request so it is not re-litigated.** Turning reasoning on (the default, and
any `effort` above `none` — `minimal` still spends 541-810 reasoning tokens) did not make
the grades better: the pass rate was identical (5/5 either way) and the verdicts were not
more discriminating. What it did do was make the output MORE VERBOSE AND WORSE — the
reasoning bled into longer, hedged evidence text — and make every call 4.7x slower with
non-deterministic latency (6-13 s instead of a flat 2.0 s), 13x slower under strict mode.
For grading, which judges one stated proposition against one answer, there is nothing to
reason about; the extra tokens are spent restating the question. `deepSeekFetch` therefore
sends `reasoning: { effort: 'none' }` unless a caller explicitly asks otherwise, and no
caller does. The same shape showed up on other models the same week: qwen3.8-flash's
thinking (274 s on one minting call for the same output as 7 s without) and glm-5.3-flash's
forced thinking (`reasoning_effort` low/high/max) — where thinking helped at all it was
for WRITING (GLM 0.60 → 0.70 as the writer at `high`), never for grading.

Three findings, and the second was genuinely surprising:

1. **`reasoning: { effort: 'none' }` is a 4.7x speedup for no measured loss.**
   Grading against a single stated proposition has nothing to reason about — the
   claim is in the answer or it is not. It also makes latency *deterministic*
   (2.0–2.1s vs 6.1–13.0s), because the variance was entirely reasoning length.
   `effort: 'minimal'` does **not** disable it (still 541–810 reasoning tokens).
   Only `'none'` does.

2. **Strict mode makes a reasoning model think ~3x harder** — 3,077 vs 943
   reasoning tokens, 26.5s vs 9.4s. The constraint appears to be something the
   model reasons *about*.

3. **With reasoning off, strict is nearly free** — 0.1s and 15 tokens. So the
   conformance guarantee costs essentially nothing in the configuration we
   actually want.

**Recommended configuration for DeepSeek grading: `effort: 'none'` + strict
schema.** Fast, deterministic, and conformance-guaranteed.

> An earlier pass of this matrix reported strict as *worse on both axes* with a
> 1-in-6 failure. That was measured with reasoning on — the one regime where
> strict is expensive — and the failure did not reproduce across 10 later strict
> runs. Recorded because the wrong conclusion is instructive: the interaction
> term mattered more than either factor alone.

### Degenerate repetition — `gemini-3.6-flash`

Given a **blank or vacuous** answer, it can fall into a restating loop: one call
spent **15,001 text tokens** (not reasoning — text) restating "no response was
provided" in a dozen forms, code-switching mid-sentence into Arabic, hit the
output ceiling and returned nothing parseable. A milder instance appended 智慧
("wisdom") after a finished English sentence.

**Root cause: no temperature was set anywhere in the codebase**, so every call
ran at the provider default of 1.0. When a grader has said the one thing there
was to say, the next-token distribution flattens — including over the stop
token — and at 1.0 the model samples honestly from that flat mess. Judgment
tasks now run at temperature 0.

---

## Instrumentation traps

Every one of these produced a wrong measurement before it was caught. They are
the reason this file exists as a method and not just a table.

1. **The AI SDK silently drops `reasoningEffort`** for models it does not
   recognise as reasoning models, logging
   `"reasoningEffort is not supported for non-reasoning models"`. An early
   matrix reported three conditions that were byte-identical because of it.
   The harness now calls the provider directly.

2. **`createOpenAICompatible` defaults `supportsStructuredOutputs` to false**,
   and when false the SDK **drops the JSON schema from the request** and sends
   `{ type: 'json_object' }`. The model is asked for "some JSON" with no shape.
   This made the `openrouter` and `custom` paths incapable of structured output
   for the life of the project, and it surfaces as `schema_invalid` — which
   reads as a bad model rather than a missing schema.

3. **`await fetch()` resolves on headers, not on the body.** Timing there
   reported 1,734 tokens in 0.4s — 4,300 tok/s. Parse the body before stopping
   the clock.

4. **`NoObjectGeneratedError` maps to `schema_invalid`**, so a call that merely
   ran out of output tokens is indistinguishable from one that cannot follow a
   schema. Always print `finishReason` and `usage.outputTokenDetails` before
   blaming the model.

5. **Reasoning tokens bill as output and are invisible in the text.** A grading
   call measured 1,963 output tokens of which 1,589 were reasoning. A cost or
   latency review counting only visible text is wrong by ~5x.

6. **One sample is not a measurement.** `liquid` passed its first run and failed
   its second. `gemini-3.7-flash` looked merely verbose until a re-test was
   inconclusive. Minimum 3, preferably 5.

---

## Cost characteristics

Measured, not quoted, except where marked transcribed.

- A 12-question diagnostic is **7 AI calls** (3 generation + 3 grading + 1
  report) and roughly **12–14k output tokens with ~5k input**.
- **Output dominates.** Calls run ~800 input against ~2,000+ output, and output
  bills several times higher. Prompt caching optimises the cheap half — and
  these prompts are below the minimum cacheable prefix on most providers.
- **DeepSeek's context cache does work**: input showed `1280 cached / 1280` on
  repeat calls, making input cost effectively nil there.
- **DeepSeek bills on a clock.** Off-peak is exactly half of peak, and peak is
  only 01:00-04:00 and 06:00-10:00 UTC on weekdays -- so most calls this app
  makes are billed at half the published headline. `pricing.ts` records the
  PEAK rate anyway: a cost figure that understates is the dangerous direction,
  and an upper bound cannot cause a surprise. Read every DeepSeek dollar figure
  in the app as "no more than". Peak, per 1M tokens, transcribed 2026-09-06:
  `deepseek-v4-flash` $0.44 in (miss) / $0.014 in (hit) / $1.32 out;
  `deepseek-v4-pro` $1.32 / $0.044 / $3.96. The hit rate is **32x** cheaper
  than a miss, which is why cached tokens are subtracted before the miss rate
  is applied rather than all input being priced the same.
- Rates live in `src/lib/ai/pricing.ts`, transcribed from the provider with a
  `checkedOn` date. **A model with no rate prices as `null`, never 0** — "$0.00"
  would read as "this was free" rather than "nobody knows".

---

## Turning this into something publishable

What exists now is an honest internal record. To publish, it would need:

- **A held-out task set.** Everything above grades the *same two answers*. That
  is enough to catch gross incapability and nothing subtler. A real benchmark
  needs a labelled set of maybe 50 answers spanning correct / partial / vacuous
  / confidently-wrong / off-topic, with human-assigned verdicts.
- **Agreement, not accuracy.** The interesting number is agreement with a human
  grader (Cohen's kappa), not a pass rate against two hand-picked cases.
- **Cost per correct judgment**, which needs the rate table populated for every
  provider tested.
- **Fixed seeds and pinned model snapshots.** `gemini-3.6-flash` is a moving
  target; `deepseek-v4-flash` may be too. Results are only comparable across
  time if the id is a snapshot.
- **Automation.** Today each run is invoked by hand and pasted here. It should
  run on a schedule, write results to a table, and diff against the last run.
- **Public inputs.** The current probes read live key points from a private
  corpus, so the numbers are not reproducible by anyone else.

The honest framing for a first publication would be narrow and specific:
*"structured-output reliability and cost for LLM-as-grader in a production
learning app"* — a real workload, honestly measured, with the failure modes
named. The instrumentation traps above are arguably the most useful part.

---

## Changelog

| Date | What changed |
| --- | --- |
| 2026-09-07 | DeepSeek peak/off-peak rates transcribed into `pricing.ts`; Qwen retried and still entitlement-blocked; shared keys + per-borrower token budget shipped. |
| 2026-09-07 | `deepseek` added as a first-class provider, verified end to end through the real app path (`deepseek-v4-flash` 2.5s / 292 tokens, `deepseek-v4-pro` 3.4s / 267 tokens, reasoning off by default). Qwen found to be entitlement-blocked. |
| 2026-09-06 | First record. Google allowlist widened to `gemini-3.1-flash-lite` on evidence; `gemini-3.4-flash` shown not to exist; Gemma rejected; OpenRouter free tier surveyed; DeepSeek `/responses` established as the working endpoint; reasoning x strict matrix run; temperature and structured-output bugs found and fixed. |

### Qwen as an AUTHOR, and the first M&A authoring bench (2026-09-11)

Three KLP-less M&A cards, `author-klps --direct --dry-run`, four models, nothing
persisted. Page with every metric explained:
https://claude.ai/code/artifact/bb78a8e9-ebaf-44bd-b589-1bebf005f80a. Full numbers in
`docs/ai/card-tagging-axes.md` Part G. Short version: gemini-3.5-flash tightest
(4 KLPs/card, sep 0.71, reference 1.00); DeepSeek most prolific and least hygienic (8.3
KLPs/card, 7 `compound` defects); qwen3.7-flash zero defects but separation at the floor,
one `accepts_weak`, and two cards where its OWN reference answer failed its own points
(0.75, 0.90). gemini-3.6-flash managed one card before every key hit the daily cap.

### qwen3.8-flash on all three jobs (2026-09-12)

Page: https://claude.ai/code/artifact/921d7155-3711-46f8-83d6-f54165d8c93e. Same prompts, same
cards, same code path as the models beside it.

**It is a THINKING model by default, and that decides how it can be used.** On the shortest
minting card, the default call took **274 s and 12,588 reasoning tokens** to produce the same
four leaves and two edges that `enable_thinking: false` produced in **7.3 s**; the 8-KLP cards
exceeded the 5-minute headers timeout three times running. `QWEN_THINKING=off` now sends
DashScope's `enable_thinking: false` through `ResolveInput.requestDefaults` (a fetch wrapper on
the OpenAI-compatible path, same pattern as `deepSeekFetch`). Off by request, not always, so
runs measured with thinking on stay comparable.

**Grading** — the pipeline's per-candidate grader on five answers to the $80/share M&A card
(reference, DeepSeek's three adversaries, "IDK") against 8 KLPs, temperature 0:

```
grader                          separation  agrees w/ authoring verdicts  mean time
qwen3.8-flash (thinking)           0.63             69%                     63.2 s
qwen3.8-flash (thinking off)       0.56             75%                     11.2 s
qwen3.7-flash                      0.44             75%                     37.0 s
deepseek-v4-flash                  0.69             78%                      2.6 s
gemini-3.6-flash                   0.44             81%                      8.6 s
```

Every grader passes the basic test (reference 1.00, IDK 0.00). qwen3.8 is the strictest
Qwen on the memorized-template answer (0.38 / 0.44 against 3.7's 0.56), which is where its
separation comes from; thinking on buys 0.07 of separation for 6x the time. DeepSeek stays
the grader: strictest, fastest, most agreement — and note it authored these adversaries, so
its agreement is partly self-agreement.

**Topic minting** (13 cards, thinking off):

```
model              kind-consistent  leaves  edges  contexts  container-leaves  self-dups  name-words
deepseek-v4-flash    97% (60/62)      38     24       32           1              2          3.07
gemini-3.6-flash     95% (59/62)      40     22       20           0              0          2.69
qwen3.8-flash        85% (52/61)      36     25       12           0              0          2.89
```

qwen3.8 is the least kind-consistent by a margin: `causal`/`condition` KLPs became leaves on
the LBO cards (six of the nine misses), one KLP left uncovered, and on the linkage card it
emitted a leaf AND an edge for five of six KLPs — the rule-6 violation — while fusing the
accounting equation into a `balance sheet` leaf. It also used `cash flow statement` and
`balance sheet` as edge ENDPOINTS. Fewest contexts of the three (12). Naming is plain and
close to Gemini's length. Nothing here recommends it over DeepSeek + Gemini as the minting pair.

**Authoring** (3 M&A cards, thinking off): 5 KLPs per card on every card, separations
0.60 / 0.40 / 0.70 (mean 0.57), reference 1.00 on all three (qwen3.7 had failed its own
reference on two), one `accepts_weak`, 4 defects (`count`, `disposition`,
`not_self_contained`, `abstraction_spread`), 3.7 relations per card with one cycle dropped.
Better than qwen3.7 as an author; still below gemini-3.5-flash on separation and reference.

**Verdict:** a usable grader only with thinking off, and even then 4x slower than DeepSeek;
not a minting candidate; a middling author. It stays out of every rotation.

### Role split: Gemini writes, DeepSeek grades — and the quality bar (2026-09-12)

`author-klps --direct` now takes an AUTHOR pool (`KLP_AUTHOR_PROVIDER` / `KLP_AUTHOR_MODELS`)
for the writing calls (`author`, `revise`) while the direct pool keeps grading, relating,
classifying and the panel. Both combos pin per card. Six M&A cards, Gemini 3.6 writing,
DeepSeek grading, dry-run:

```
card                                              KLPs  sep   ref   smoke  revised
$80/share premium                                  5   0.90  1.00  pass   -
sources & uses schedule                            5   0.60  0.90  pass   2x (0.40 -> 0.60)
two ways an acquisition creates value              5   0.90  1.00  pass   -
$1.8B / 50% debt / 5-year hold — what buyer         5   0.60  1.00  pass   -
whose WACC discounts the target                    4   0.88  1.00  pass   -
all-stock vs all-cash                              6   1.00  1.00  pass   -
mean separation 0.81; 30 KLPs; 28 relations; Gemini calls per card 1-3 of 7-17
```

Against the single-model bench on the same first three cards: mean separation **0.80 vs
0.71** (gemini-3.5-flash, the previous best), reference 0.97, 2 defects (`ordering`,
`abstraction_spread` — both post-loop rules), 4.7 relations per card. A key now authors
6-10 cards a day instead of 2, because the capped provider only writes.

**The quality bar** (`REVISION_BAR = 0.60`, `src/lib/klp/authoring-config.ts`): a card is
revised, up to `MAX_REVISIONS`, when its separation does not clear the bar, its reference
fails a point, a text-level hygiene defect fires, or a weak answer passes the smoke test.
Every finding is named per point with its fix in `REVISE_KLPS_PROMPT` v3 (`compound —
split it into two`, `accepted by the vague answer — tighten`, `reference scored partial —
rewrite or cut`). On this run the bar revised the sources & uses card twice and took it
from 0.40 to 0.60. With `<` it revised 1 of 6; the bar is now inclusive (`<=`), which
revises 3 of 6 on the same numbers. The run summary prints the revised share and warns
under a fifth. `ordering` and `abstraction_spread` are outside the bar: they need the
edges and the classification, computed after the loop.

### glm-5.3-flash (Z.ai), funded 2026-09-12 — the owner's replacement for gemini-3.6-flash

Page: https://claude.ai/code/artifact/8901ecef-ba2a-4af1-bb15-1116b29aeddb. Authoring
bench with a five-column default view (Gemini 3.6 flash / Gemini 3.6 flash + DeepSeek /
GLM 5.3 flash (high) / GLM 5.3 flash (high) + DeepSeek / DeepSeek):
https://claude.ai/code/artifact/bb78a8e9-ebaf-44bd-b589-1bebf005f80a.

**Every GLM number below is `glm-5.3-flash`.** Bare `glm-5.3` exists on the endpoint and
costs more than gemini-3.6-flash; it was probed once for existence and never run. The
bench labels were shortened to "glm-5.3" for a while and the owner read them as the
non-flash model — they now say `-flash` everywhere. Verified from the run records:
`CardAuthoring.model` reads `glm-5.3-flash+deepseek-v4-flash` on every split card.

**Two endpoint facts decide how it is called.** Z.ai's compatible endpoint accepts only
`response_format: json_object` (its own docs) and IGNORES a json_schema: every schema call
came back as fenced ```json in the model's own field names. `ResolveInput.schemaInPrompt`
(set by the `zai` pool source) moves the SDK's schema into the last user message, requests
`json_object`, unfences `choices[].message.content`, and leaves Zod to validate — so a
model that ignores the prompted schema fails loudly, not silently. And thinking is FORCED
ON (`1210 cannot be disabled; use low, high, or max`); the level is the OpenAI-style
`reasoning_effort`, exposed as `ZAI_REASONING_EFFORT`. Measured on one call: 1.3 s / 36
output tokens at `low`, 5 s / 415 at the default. Free `glm-4.7-flash` cannot hold a schema
even in the prompt; `glm-5.2-flash` is not a model id.

**Grading** (same five answers, 8 KLPs): separation 0.44, 66% agreement with the authoring
verdicts, 17.9 s mean — the weakest grader measured. DeepSeek stays the grader.

**Topic minting** (13 cards, single model, default effort):

```
model              kind-consistent  leaves  edges  contexts  container-leaves  self-dups  name-words
deepseek-v4-flash    97% (60/62)      38     24       32           1              2          3.07
gemini-3.6-flash     95% (59/62)      40     22       20           0              0          2.69
glm-5.3-flash        89% (55/62)      33     29       32           1              0          2.69
qwen3.8-flash        85% (52/61)      36     25       12           0              0          2.89
```

The best minter after the two it would replace, and uncapped. On the three-statement
walkthrough it produced exactly the rule-3 shape the owner asked for (`income statement`
leaf + `revenue --precedes--> net income` + `profitability measurement` context); on the
linkage card 0 leaves and 8 clean edges. Names as short as Gemini's. `MINT_B_PROVIDER=zai
MINT_B_MODEL=glm-5.3-flash` puts it on the Gemini side of the dual pair.

**Authoring as the WRITER** (role split, DeepSeek grading, same three M&A cards), plus
GLM grading its own material for the comparison the owner asked for:

```
writer / grader                                 KLPs/card  mean sep  min sep  reference  revisions
gemini-3.6-flash writes, deepseek grades           5.0        0.80     0.60      0.97       2
glm-5.3-flash (default) writes, deepseek grades    8.7        0.60     0.44      0.93       6
glm-5.3-flash (high) writes, deepseek grades       7.0        0.70     0.63      0.98       2
glm-5.3-flash (high) writes AND grades             8.3        0.68     0.61      0.98       5
deepseek-v4-flash writes AND grades                8.3        0.63     0.50      0.98       0
```

GLM grading itself lands near the DeepSeek-graded number (0.68 vs 0.70) but needs five
revision rounds to get there against two — the stricter grader reaches a clean set
faster, and self-grading is the leniency the split exists to remove. Every GLM row is
7-9 points a card where Gemini writes 5; whether that is coverage or padding is a
point-by-point read on the bench page.

At default effort it over-writes (8.7 points a card against the six the prompt leans to)
and needs both revision rounds on every card. At `high` it is a different writer: 0.70,
every card clears the floor by a margin, one revision in three. Still a step below Gemini
3.6 (0.80), but it has no daily cap and costs a fraction. **Recommendation:** writer =
`glm-5.3-flash` with `ZAI_REASONING_EFFORT=high`, grader = DeepSeek, minting pair =
DeepSeek + GLM. Gemini 3.6 stays the quality reference, not the workhorse.

A solo GLM authoring run (GLM grading itself) stalled 15 minutes on one card and was
stopped; the grading number above already says why it is not a grader.

### The rebuild test, first run (2026-09-12) — the dispute channel fired on card 3

`author-klps --rotate --rebuild --dry-run`, three bench cards, rotation `cn + qwen` (Gemini
capped for the day): DeepSeek wrote, Qwen wrote the traps and the rebuild, GLM (high) graded.
Design: `docs/superpowers/specs/2026-09-12-rebuild-test-design.md`.

```
card                      sep   coverage  parity  lost claims (of N)   dispute
$80/share premium         0.71   1.00      0.83    3 of 12             -
sources & uses schedule   0.39*  1.00      0.88    3 of 17             -
2 ways to create value    0.63   1.00      0.85    3 of 17             YES
* low_discrimination - Qwen's adversaries scored high under GLM grading
```

**The dispute is real and it is the card's known error.** On "2 ways an acquisition can
create value" the card's parenthetical reads "Value Arbitrage (purchase price > NAV)"; the
grader raised: *"buying at a price above NAV would destroy value absent synergies, whereas
arbitrage value comes from paying a price below the target's intrinsic NAV"* — the same
inversion the writer had flagged in `concerns` on 2026-09-12's first authoring run. Two
roles, two families, same finding, surfaced as a warning to the owner. The channel works.

**Coverage 1.00 on all three is the rubric's grain, not the sets' completeness.** The
sources & uses definition splits into TWO points ("Sources: new debt tranches, equity
contribution, target cash, rollover equity" / "Uses: ..."), so a rebuild that mentions the
items at all is `correct` on both, and the sponsor-equity gap the owner spotted is
invisible to it — exactly the limit the spec states. The card is the rubric; a terse card
is a coarse rubric. Two fixes, in order of value: the writer's `definitionPoints` step
should split a listed item into its own point (each source and each use), and the owner
can enrich the definition or notes. Until then, treat coverage as a floor check and read
parity.

**Parity is the informative number.** 12-17% extraction loss on every card, and the lost
claims are substantive: "the sources & uses and the purchase price allocation are prepared
together at signing", "the arbitrage gain accrues to shareholders the moment the deal
closes", the numeric illustration, the sinkhole example. Those are the things the writer
knew that never became a key point.

**Two defects found by running it:** the writer did not rotate (every role was stamped
"tried" at the same instant, so the LRU order never moved - fixed with a separate
`lastWrittenAt`); and Qwen as adversary writer produces traps the graders score high,
which reads as low separation - the owner predicted "artificially low numbers" from Qwen
and was right about the direction, though it shows in the adversary role, not the
reference. Re-run with Gemini in the rotation before drawing a model conclusion.

### Framing points and kind-aware strictness, first run (2026-09-12, evening)

Design: `docs/superpowers/specs/2026-09-12-framing-points-design.md`. Same bent
configuration as the spread (GLM 5.3 flash `high` writes; DeepSeek revises, writes the traps,
rebuilds, grades strictly), `--dry-run --force` on the three M&A cards the spread had flagged.
Two changes between the runs: definition/contrast points the template trap passes are
`framing` and leave the separation the bar reads; and the strict grader sees each point's
kind, relaxing on mechanism/condition/quantitative and staying strict on causal.

```
card                         spread   full   substance  framing  template  status
2 ways to create value        0.29    0.38    0.60       3/8      0.63     separated (was low_discrimination)
WACC 6% / acquirer's yield    0.22    0.81    0.81       0/8      0.00     separated
sell-side process (8 steps)   0.39    0.61    0.61       0/9      0.39     separated
mean                          0.30    0.60    0.67
```

**What the split did.** On the acquisition-value card the three points the template recites —
"value creation means the shareholders are wealthier, distinct from accretion", "the first way is
value arbitrage: …", "arbitrage and synergies are the economic sources, distinct from accounting
accretion" — are now framing; the five substance points separate at 0.60 and the card is no
longer flagged. The other two cards had no framing point: their definitions are step
descriptions the template did not fully recite, so the rule left them alone. That is the rule
working as specified, not the rule being lenient — it moved exactly the card whose low number
was a definition problem.

**Attribution warning on the WACC card.** 0.22 → 0.81 is NOT a measurement of kind-aware
strictness. The writer produced a different draft: this reference gets both tests right (8% <
10% blended cost → EPS dilutive; 8% > the target's 6% → positive NPV), where the spread's
draft had the knowledge gap the owner spotted. The template trap scored 0.00 against it. GLM
sometimes has this one and sometimes does not; the rotation's "next family" re-author is still
the right handling, and a per-clause A/B on a fixed draft is the only way to price the
strictness change (`KLP_GRADE_STRICT` with and without kinds, same stored draft — not run).

**A hole found by running it: the writer's `definitionPoints` can launder the card.** The card
reads "Value Arbitrage (purchase price > NAV)" — the inversion the dispute channel caught on the
first rebuild run. This time the writer split the definition into "buying the target at a price
that *differs from* the worth of its underlying assets", the rebuild said "less than", the
coverage grader marked it `correct` against the sanitised point, and `disputes` was empty. The
dispute channel only sees the split, and the split is written by a model that already knows
the right answer. Fix (queued): `definitionPoints` must quote the card's own wording, or the
coverage grader must receive the raw definition beside the points. Until then a clean
`disputes` on a card with a known error means nothing.

**Cost.** Unchanged: 17 calls per card with the rebuild, no new call. Two DeepSeek structured-
output failures on the sell-side card (schema mismatch, then unparseable) were retried on the
same combo and passed; 25 KLPs, breadth histogram 0 / 3 / 12 / 10 by adversaries failed.

### What a card costs — first metered run (2026-09-13, 06:28 UTC, DeepSeek off-peak)

`scripts/author-klps.ts` now meters every successful direct call by step and model
(`src/lib/klp/token-meter.ts`; printed at the end of a run and written to `--json` as
`tokens`). List prices copied 2026-09-12: DeepSeek v4-flash $0.30 in / $0.006 cache hit /
$1.20 out per 1M at peak (half off-peak; peak = Mon-Fri 01-04 and 06-10 UTC); GLM 5.3 flash
$0.15 / $0.03 / $0.50 flat. Two M&A cards, the owner's bent configuration (GLM `high`
writes; DeepSeek revises, writes traps, rebuilds, grades strictly), `--rebuild`:

```
step         model              calls     input   cached   output reasoning      USD
adversaries  deepseek-v4-flash      2      1730      256      947         0   0.0008
author       glm-5.3-flash          2      3747        0     4736      1827   0.0029
classify     deepseek-v4-flash      2      1653      512      214         0   0.0003
coverage     deepseek-v4-flash      2      2042      256      764         0   0.0007
grade        deepseek-v4-flash     20     30327    12288     9860         0   0.0087
parity       deepseek-v4-flash      2      2107        0     1540         0   0.0012
rebuild      deepseek-v4-flash      2      1035      0       541         0   0.0005
relate       deepseek-v4-flash      2      2199      256     1829         0   0.0014
revise       deepseek-v4-flash      3      3594      128     1197         0   0.0012
TOTAL                              37     48434    13696    21628      1827   0.0178
per card: 19 calls, 35,031 tokens (24,217 in / 10,814 out, 914 reasoning) ≈ $0.009 off-peak
```

Read it as: **under a cent a card off-peak, under two cents at peak.** Grading is half the
spend (20 of 37 calls — four candidates per round, two rounds on a revised card) and 40% of
its input was a cache hit, because the reference and the key points repeat across the four
candidates. The writer, with `high` reasoning on, is a third of the bill. The rebuild test
(rebuild + coverage + parity) is ~$0.0012 a card — an eighth of the total. Failed attempts are
not metered (the SDK reports no usage on a failure), so a card that hit two schema retries
cost a little more than shown.

**Scaled:** the ~200-card corpus is $2-4 at these rates; every dry run in this file so far
totals well under $5. The stronger models the owner asked about: DeepSeek v4-pro as the grader
is 4.4x the grading line (≈ +$0.02/card); bare GLM 5.3 as the writer is ~9x the author line
(≈ +$0.025/card). Either is still cents. **Cost is not what decides between "more checks" and
"a better model" at this scale — variance is.** The acquisition-value card scored 0.29, 0.38
(0.60 substance) and 0.31 on three runs of the same configuration in one evening; that spread
is larger than most effects measured here, so any new check has to be judged over repeated
runs, not one.

### The cost cuts, measured (2026-09-13, same two M&A cards, off-peak)

Five changes, all on the owner's read of the first metered table, then the same pair
re-run (`--dry-run --force --rebuild`, GLM `high` writes, DeepSeek does the rest, strict):

1. **`confident_wrong` cut** (`PROBE_KINDS` is now `vague`, `memorized_template`; the old
   kind survives as `LEGACY_PROBE_KINDS` for stored rows). It scored 0.00-0.19 on every run
   in this file and never set the best-wrong bar.
2. **Incremental regrading** (`src/lib/klp/regrade-plan.ts`): a revision round carries every
   verdict on a point whose text did not change, grades only the rewritten points per kept
   candidate (one short call each), rewrites only the trap that beat the last set (credited
   on a substance point, or the best wrong answer under an uncleared bar) and grades that
   one in full. The reference is "adjusted" the same way — carried plus partial.
3. **Grader evidence only off a `correct` verdict, one clause** (grade-candidate v2, coverage);
   relate rationale/probe capped at a sentence. No computation reads any of these strings.
4. **Prefix order for the DeepSeek cache**: shared part first, candidate answer last.
5. **`KLP_AUTHOR_BATCH`**: N cards per writer call, drafts cached and served per card.
   Plus **one immediate retry on a malformed reply** — before this, one bad JSON ten calls
   into a card restarted the whole card ("trying another model" with one combo in the pool).

```
                     baseline (2026-09-13 06:28)      after (2026-09-13)
calls                       37                          33
input / cached          48,434 / 13,696            36,062 / 10,752
output (reasoning)      21,628 (1,827)             11,866 (1,993)
grade calls / output    20 / 9,860 → $0.0087       15 / 2,300 → $0.0031
author                  2 calls  → $0.0029         1 batch call → $0.0026
TOTAL                   $0.0178  ($0.0089/card)    $0.0105  ($0.0053/card)   −41%
```

Where it came from: grade output −77% (the evidence rule), grade calls −25% (two traps,
partial regrades), author input shared across the pair. The batch call itself is a small
saving — a card's own content is most of an author prompt — and GLM's batch reply failed the
schema once in three tries, which the retry now absorbs. Quality on the pair: separation
0.92 / 0.67, coverage 1.00 / 0.69, parity 0.91 / 0.81, both `separated`; the same-card
variance recorded above still applies, so read the cost column, not the quality column.

Peak-hour warning: the script now prints a notice when a DeepSeek run starts inside Mon-Fri
01-04 / 06-10 UTC (2x the off-peak rate).

### The communication check and the parity bar, first run (2026-09-13, three M&A cards)

Built on the owner's two asks: a grader-family review of the reference (accuracy /
conciseness / clarity, categorical; `src/lib/ai/prompts/review-reference.ts`), with ONE writer
rewrite when TypeScript says the labels warrant it (anything but sound / tight / clear), and
the rebuild test run EVERY round with parity below 0.70 (`REBUILD_PARITY_BAR`) and coverage
misses folded into the same revise call as the separation findings. The reviewer reads the
rebuilt answer too, so the two reviews can be compared.

```
card                       sep (subst)  ref review → rewrite   parity  rebuilt review     ref → rebuilt words
2 ways to create value     0.31 (0.50)  sound/wordy/clear → Y   0.91   sound/wordy/clear   171 → 231
WACC 6% / yield            1.00 (1.00)  sound/wordy/clear → Y   1.00   sound/wordy/clear   175 → 216
sell-side (8 steps)        0.33 (0.38)  sound/wordy/clear → Y   0.79   sound/wordy/clear   234 → 324
```

**Accuracy: the hedge is gone.** The WACC reference after the rewrite reads "This deal is EPS
dilutive but value creating ... Earning 8% on an investment whose risk justifies only a 6%
return means the IRR exceeds the appropriate cost of capital — a positive-NPV, value-creating
deal." The review labelled the first draft `sound` on accuracy — it was the wordiness that
triggered the rewrite — so on this run the accuracy check was not what fixed it; the draft was
already right (GLM's coin came up heads). The instrument for the hedge exists; it has not yet
caught one live.

**Conciseness: every reference was "wordy", and every REBUILT answer was wordier still**
(+25-40% words). The reviewer's reasons are specific and right: the restated conclusion, the
roadmap given twice, and on the sell-side card "three sentences on a step (exclusivity) the
card doesn't carry". That last one is a content finding the coverage grader cannot make (it
only checks the card's points are present, not that extra ones are absent). The rebuilt
answer being longer than the reference is the key points carrying context clauses each
("because ...", "which is why ...") that the rebuilder dutifully expands — the v3 author prompt
allowed one clause per point, and eight points with a clause each is a long answer. Not acted
on yet; recorded on `rebuild.communication`.

**Parity: 0 of 3 below the bar after the loop**, with the lost claims named to the revise call
when a round dipped. Cost of running the rebuild every round: rebuild/coverage/parity went from
one set per card to one per round — the parity grade's output (it lists every reference claim
each time) is the largest new line. Per card: $0.0053 → $0.0077 off-peak, 25 calls. The review
itself is ~$0.0004 a card.

**The WACC card separated at 1.00 with 6 points** — the tightest reference of the three gave the template nothing to recite. **Separation fell on the other pair** (0.92/0.67 last run → 0.31/0.33; the acquisition card's
substance 0.50). Not attributable on one run — the traps are written from the reference, and a
tighter reference gives the template trap less to paraphrase, which is one mechanism; run-to-run
variance on these two cards has been 0.29-0.92 today, which is the other. The rewrite is the
first change in this file that could plausibly LOWER separation, so it needs the 7-card spread
×2 before it stays on by default (`KLP_COMMS_CHECK=false` turns it off).

### Compression as a revise input — the spread ×2 (2026-09-13)

The owner's six-step plan, built as written: (A) the grader reviews the rebuilt answer
against the numbered points every round and names the points behind each issue —
restatement / clause bloat / not-on-card / transition — and TypeScript makes them per-point
findings for the same revise call; (B) a precedence rule in the revise prompt, *cut words,
never distinct claims*; (C) a `verbose` hygiene rule (>30 words or two subordinate clauses)
and the rebuilt/reference word ratio (>1.2 is a set-level finding); (D) rebuilder v2 says each
point once, no transitions, no restated conclusion; (E) author v5 asks for ~25-word points and
no conclusion stated twice; (F) the 7-card definition-length spread, twice, `--rpm 40`.

```
card                              before (09-12)          run 1                   run 2
                                  sep  par  ratio n       sep  par  ratio rev  n  sep  par  ratio rev  n
intangibles off the balance sheet 0.50 0.92 0.80  7       0.83 0.58 0.53 tight 6  0.30 0.70 0.63 bloat 5
CapEx & depreciation, mature/new  0.81 0.77 0.69  8       1.00 0.95 0.83 wordy 7  0.60 0.50 0.46 tight 5
DTL vs DTA                        0.44 0.97 0.79  9       0.78 0.75 0.58 tight 9  0.89 0.58 0.74 tight 9
luxury soap (working capital)     0.72 0.79 0.72  9       0.67 0.71 0.86 tight 9  0.56 0.70 0.85 wordy 9
2 ways to create value            0.29 0.82 0.62  7       0.75 0.67 0.83 tight 6  0.92 0.75 0.61 tight 6
sell-side process                 0.39 0.68 0.70  9       0.83 0.73 0.76 tight 9  0.44 0.91 0.87 tight 9
WACC 6% / yield                   0.22 0.79 1.21  9       0.75 0.92 0.80 tight 6  0.93 0.80 1.25 wordy 7
mean                              0.48 0.82 0.79  8.3     0.80 0.76 0.74       7.4 0.66 0.71 0.77       7.1
low_discrimination                3                       0                       1
rebuilt reviewed "tight"          -                       6/7                     4/7
reference words (mean)            316                     192                     198
cost per card (off-peak)          -                       $0.0083                 $0.0075
```

**Against the acceptance criteria set before the run:** rebuilt review `tight` on at least
half the cards — 6/7 and 4/7, met. Word ratio ≤ 1.1 — 0.74 and 0.77, met (the rebuilt answer
is now shorter than the reference, and the reference itself is 40% shorter than before the
communication check). Substance separation not lower than the last spread — 0.80 and 0.66
against 0.48, met, with low_discrimination 3 → 0 / 1. Parity ≥ 0.7 — met on the mean (0.76,
0.71) and **not on every card**: two cards in run 1 and three in run 2 finished under the
bar after the two revision rounds. The plan said that if parity dropped when compressing, the
precedence rule was wrong and it would be reported rather than tuned — here is the report.

**What actually cut the parity.** The CapEx card in run 2 (parity 0.50, five points) had its
round-2 revision triggered by `not_on_card: "the fixed asset base shrinks is an implication the
card owner's definition does not carry"`. The reviewer was right that the card does not say it;
the parity grader then listed it, and four other claims, as lost — "CapEx below depreciation at
a mature firm may signal underinvestment", "high CapEx at a young firm depresses current
earnings". Those are exactly the things the author prompt tells the writer to ADD ("what a
strong answer needs that the card omits"), and the owner does not enrich terse cards. So
`not_on_card` was cutting the reference's own content one round before the parity grader could
object to the cut, and with `MAX_REVISIONS` 2 there was no round left. **`not_on_card` is now
recorded and never a finding** (`src/lib/klp/compression.ts`); restatement and clause bloat
remain. The precedence rule itself held: no run lost a claim a parity finding had named.

**Variance is still the largest effect in the table.** The same card, same configuration,
40 minutes apart: CapEx 1.00 → 0.60, sell-side 0.83 → 0.44, intangibles 0.83 → 0.30. Every
comparison in this file is subject to that; the mean over seven cards moves less, and the
direction of the mean (0.48 → 0.80 / 0.66) is what the change is judged on.

**Cost with everything on:** 28-29 calls and ~$0.008 a card off-peak. The per-round rebuild
(rebuild + coverage + parity + review, ~4 calls) is the bulk of the increase over the $0.0053
the cost pass reached; grading is no longer the largest line.

**Confirmation, the two accounting cards with `not_on_card` off:** intangibles 0.67 / parity
0.80 / ratio 0.58 / tight; CapEx 0.83 / parity 0.83 / ratio 0.82 / tight. Both clear every bar.
This is the configuration the corpus is authored with.

### The corpus, re-authored end to end (2026-09-13 → 14)

Every authored set through the current pipeline — GLM 5.3 flash `high` writes (batched 5) and
rewrites; `deepseek-flash` reviews the reference, writes the two traps, grades strictly with
kind-aware relaxation, rebuilds every round, reviews the rebuilt answer for compression,
labels framing (last two sets), and the best round is kept. 278 cards, 0 failed, every card
authored at its current version. Off-peak, about $2.40 in total at list.

```
set                       cards  sep   substance  parity  coverage  separated  low_disc  memorizable  live KLPs  framing share  framing by
M&A                          82  0.65    0.70      0.91    0.98        79         3          0          637        7%         rule
Accounting - Knowledge       50  0.69    0.75      0.93    0.96        49         1          0          402        8%         rule
Talking (copy/test)          68  0.67    0.75      0.92    0.98        68         0          0          475       11%         rule
Accounting - "Talking"       68  0.68    0.82      0.89    0.99        53         1         14          460       42%         judged
LBO                          10  0.67    0.76      0.91    1.00         9         0          1           71       37%         judged
```

**What the run itself found.**
- The M&A pair (old role-split run vs new): separation flat (0.67 → 0.65 under strict grading),
  parity up where measurable, `low_discrimination` 1 → 3. The decomposition put the whole
  separation change on the `memorized_template` trap scoring higher — on the numeric scenarios
  it was a correct answer wearing the trap's label (WACC card: 0.81 against the points). Fixed
  in `write-adversaries` v3 (the template must be wrong) for the sets after M&A; the M&A,
  Accounting-Knowledge and Talking-copy cards keep the v2 traps per the owner ("let's not
  re-make them").
- Three processes authored Accounting-Knowledge at once for ~25 minutes (a killed run's
  wrapper survived and moved on; a second watcher started the same set): 52 extra
  `CardAuthoring` rows on 28 cards, superseded, no learner evidence, left in place.
- The internet dropped mid-run at 00:23; Talking copy stopped at 66/68 with `ENOTFOUND`
  on both providers, Accounting-"Talking" and LBO could not open the database. Resumed from
  03:12; the resumable skip and the failed-card retry did the rest.

**Framing, rule vs judged.** Under the rule (definition/contrast the template recited) 7–11%
of points are framing. Under the judged classifier (`classify-roles`, a grader-family model
labelling by judgement — a restated given, a plug-in comparison, the mechanical conclusion
label, the stock contrast) it is 37–42%, and 15 cards are `memorizable` (≥ 60% framing).
Substance separation on those sets reads 0.82 / 0.76 against 0.70–0.75 on the rule sets — some
of that is the classifier taking more points out of the denominator, not sharper points. The
memorizable list, each framing point with the judge's one-clause reason, is on the dashboard
for the owner to read; the classifier's leniency is a judgement to make there, not here.

**Cost per card, all-in:** M&A $0.0085 (30 calls); the judged sets add one call per round.

### Prefix order for the cache (2026-09-14)

The corpus meters summed to 8.25M input tokens with 2.1M cache hits — 25% — and the owner's
DeepSeek dashboard showed ~7M misses (the meter plus unmetered failures and the stray
duplicate runs). DeepSeek's cache is a prefix cache in 64-token blocks, and every prompt
reached its card-specific content (`Question: …`) within ~40 tokens, so nothing was shared
across cards; the only hits were repeats within a card (grade 43%, revise 5%, rebuild 2%).

Every DeepSeek-facing prompt now opens with its static instructions — role, rules,
vocabulary, output format, strictness — and puts the card, then the per-call content, last
(grade-candidate v3, write-rebuild v3, grade-coverage v2, grade-parity v2, review-reference
v2, review-rebuilt v2, revise-reference v2, revise-klps v5, relate-klps, classify-roles v2,
classify-abstraction, write-adversaries v4). `tests/ai/prompt-prefix.test.ts` pins that no
card text appears in the first 400 characters of any of them and that two cards share the
same prefix.

Two-card dry run after the change (the smallest possible test — the first card of a run
always misses the shared prefix): overall hit 25% → 34%; grade 43% → 54%, coverage 24% →
42%, parity 20% → 30%, review-rebuilt 21% → 33%, relate 13% → 35%, rebuild 2% → 18%, roles
14% → 32%. Across a set the shared prefix hits on every call after the first, so the corpus
figure should land higher than the two-card one; the meter on the next set-sized run is the
number to read. The prize is bounded: ~250 shared tokens × ~8,000 calls ≈ 2M tokens moved
from miss ($0.15/M off-peak) to hit ($0.003/M) — about $0.30 on a $2.40 corpus — because
output tokens, not input, are most of the bill.

### Mint stability, the KLP/KLT enforcement statistic, and containment as placement (2026-09-14/15)

**Stability.** Ten cards minted twice, DeepSeek + GLM with DeepSeek judging. At the provider
default temperature, run-to-run leaf agreement was 0.42 exact / 0.67 loose for DeepSeek,
0.51 / 0.64 for GLM, edges 0.15–0.19 exact; the union merge inherited the worse side. The
`--direct` scripts had never set a temperature (production `generateJson` runs at 0). At
temperature 0 DeepSeek reads 0.88 / 0.93 on leaves and 0.63 / 0.76 on edges; GLM 0.62 / 0.71
at `high` reasoning and 0.68 / 0.76 at `low` — its randomness lives in the reasoning mode.
Decision: DeepSeek at 0 is the minter; GLM is not a merging side.

**KLP/KLT enforcement** (`src/lib/klp/topic-enforcement.ts`): share of points whose minted
shape agrees with the intention — an edge when the point is the source of a directed link in
the card's own `KlpRelation` graph (now shown to the minter), else the kind prior. On 53
cards (12 per set, DeepSeek at 0): **0.81 before repair, 1.00 after** one repair call on 38
cards (only the violating points, the proposal's names as endpoint vocabulary; ~130 input /
~15 output tokens per point). "Why GAAP is important?" went 0.60 → 1.00. Kind-prior
violations in the earlier sample were 18% of points, almost all causal/condition points
minted as leaves; with the graph supplied and the repair on, zero remain.

**Containment across cards is placement, not identity** (`src/lib/klt/match.ts`). The
reconciler's containment rule ("accounting equation" ⊂ "fundamental accounting equation")
is right between two models naming one KLP and wrong between cards: the first trace showed it
folding "acquired deferred revenue write-down" into "deferred revenue" and "purchase price"
into "purchase price allocation". Now a containment hit mints the specific name as its own
node **placed under** the general one; only exact / alias / initials (and a token
permutation) say "same". On the 53-card sweep: 172 names resolved to existing topics, 89
placed under an existing one, 125 ambiguous (kept at the 0.4 floor — the owner wants the
judge to see near misses to big concepts, to become context links), 222 new; vocabulary
118 → 554.

Trace artifact: https://claude.ai/code/artifact/6771699e-1d94-4627-bcc5-6d91267e2bcd

### The whole-card minting loop over the corpus (2026-09-15)

Built in one pass on the owner's go: round-trip recovery and distinctness (the two missing
settings), the loop (`src/lib/klp/topic-loop.ts`: anchored mint → settings + enforcement +
round-trip → named findings → one combined revise → re-measure, two rounds, best round kept),
the operator script (`scripts/mint-loop.ts`, dry, resumable, metered), the offline rescorer
(`scripts/score-loop.ts`), and the set-level tree rebuild planner (`src/lib/klt/rebuild.ts`,
`scripts/rebuild-tree.ts`, plan only).

**Run: 155 of 278 cards** (M&A 78, Accounting-Knowledge 50, Talking copy 27) before the
DeepSeek balance ran out ("Insufficient Balance" on the remaining 119; the loop resumes from its
JSON once it is reloaded). 4 M&A cards failed the schema after a retry. Cost: **5 calls and
$0.0014 a card** off-peak (mint 1, round-trip 1 per round, revise ≤2).

```
setting        mean   p10   p25   p50   p90    bar (provisional)
overall        0.92   0.85  0.87  0.93  0.99
coverage       1.00   1.00  1.00  1.00  1.00   1.00
anchored       1.00   1.00  1.00  1.00  1.00   0.90
causalEdges    0.93   0.67  1.00  1.00  1.00   0.90
causalTargets  0.67   0.00  0.33  1.00  1.00   —
brevity        0.98   0.90  1.00  1.00  1.00   0.80
vocabulary     0.83   0.65  0.74  0.83  1.00   —
noContainers   0.99   1.00  1.00  1.00  1.00   —
distinctness   0.99   1.00  1.00  1.00  1.00   0.90
roundTrip      0.90   0.75  0.86  1.00  1.00   0.75
enforcement    0.98   0.88  1.00  1.00  1.00   1.00
clear 111 / 155 (72%); flags: causalEdges 21, enforcement 18, roundTrip 12, brevity 4, distinctness 3, coverage 1
```

**What the distribution says.** The anchored prompt plus the loop hold coverage, anchoring,
containers and distinctness at 1.00 across the corpus. Cards fail on two things: a causal
point minted without a directed edge (the measure originally counted only causes / precedes /
applies_within — `requires` is a fifth of how the minter renders causal points and is right
to, so it now counts; `confused_with` on a causal point is the real miss, 9 of 130 on M&A), and
round-trip recovery — a grader shown only the labels files 10% of points elsewhere.
`causalTargets` (the edge names the point that supplied its cause) is the weakest number at
0.67 and deliberately not a bar: the model gets the edge right more often than it says where
the cause came from. Bars stay as set; the p10 column is what they were set against.

**The rebuilt M&A tree** (78 cards → 568 nodes: 67 anchors, 365 leaves, 128 endpoints, 7
contexts; anchors matched 23 exact / 10 placed / 1 initials / 44 new; 11 anchor clusters, 7
wanting a parent). The anchors are right and recur — accretion/dilution, synergies, purchase
price, earnings yield each gather several cards — and the clusters read as a person would group
them (accretion family; synergies; acquisition; value creation). Below the anchors the tree is
wide and one card deep: 16 nodes active by recurrence, and **0 of 499 edges shared by two
cards**. That is the endpoint-naming problem ("deal financing cost" / "financing cost" /
"acquirer wacc funding cost" are one thing) and it is the next fix: roll an edge up to the
general node its endpoint was placed under, so specific endpoints count for the concept they
sit beneath. Until then the DAG view's ≥2-card rule would show nothing.

Artifact: https://claude.ai/code/artifact/668011a7-089e-43f1-83e0-cba953633660

### The corpus finished, the M&A tree written, the DAG view (2026-09-15, later)

**Loop finished: 276 of 278 cards** (M&A 80 of 82 — two cards fail the schema every time;
Accounting-Knowledge 50, Talking copy 68, Talking 68, LBO 10), resumed after the owner reloaded
DeepSeek. Rescored together (`docs/ai/runs/2026-09-15/dist-all.json`):

```
setting        mean   p10   p25   p50   p90    bar
overall        0.92   0.85  0.88  0.93  0.99
coverage       1.00   1.00  1.00  1.00  1.00   1.00
anchored       1.00   1.00  1.00  1.00  1.00   0.90
causalEdges    0.94   0.75  1.00  1.00  1.00   0.90
causalTargets  0.67   0.00  0.33  1.00  1.00   —
brevity        0.98   0.90  1.00  1.00  1.00   0.80
vocabulary     0.83   0.67  0.75  0.85  1.00   —
noContainers   0.99   1.00  1.00  1.00  1.00   —
distinctness   1.00   1.00  1.00  1.00  1.00   0.90
roundTrip      0.90   0.75  0.86  1.00  1.00   0.75
enforcement    0.98   1.00  1.00  1.00  1.00   1.00
clear 198 / 276 (72%); flags: causalEdges 35, roundTrip 26, enforcement 25, brevity 10, distinctness 5, coverage 1, anchored 1
per set: M&A 59/80 · Acc-Knowledge 34/50 · Talking copy 50/68 · Talking 49/68 · LBO 6/10 — every set 0.92 overall, 0.90 round trip
```

The distribution is the same shape on the second half of the corpus as the first: the bars
hold where they held, and the two fail modes are unchanged. Nothing about the loop is
set-specific.

**The M&A tree, WRITTEN.** `scripts/rebuild-tree.ts --write --name-clusters --reset-placement`
over `src/lib/klt/rebuild-write.ts`: 80 cards → 582 plan nodes; 543 placed under one root (the domain): 34 branches, then
200 / 227 / 71 / 9 / 1 nodes at levels 2–6; 1,080 KLP↔topic links (rank 1 leaf, rank 2 context AND
the card's anchor on every point); 493 minted + 146 rolled-up relations, 29 directed edges refused
because they would close a cycle; 6 paths refused by `applyPaths` (a repeated segment). Six ★ clusters named by one DeepSeek call each (all six
answered, none declined): *purchase price allocation* (deferred revenue, goodwill, revenue
synergies, bargain purchase gain, section 382, asset write-up, gross NOLs, deferred taxes …),
*synergies* (a member — break-even synergies, synergy distribution, breakeven cost of debt under
it), *deal consideration* (offer price, consideration choice, inbound offer), *accretion/dilution
analysis* twice (the value-creation cluster AND the accretion family both named it, so both
merged under one branch), *acquisition strategy* (financing currency, merger vs acquisition,
accretive acquisition, evaluation, candidate, success). The names are the ones a person would
write. 17 minted names exceeded the tree's own cap (4 words / 40 chars: "discount rate for
target cash flows", "strategic buyer vs financial buyer") and are reported, not placed — their
KLPs are still linked to the anchor.

Three defects the write exposed, all fixed with tests:
1. **Two normal forms.** `Klt.normalizedName` is the tree's form (`normalizeKltName`: lower-case,
   punctuation stripped); the matcher's `normalizeName` singularises and expands abbreviations.
   `matchConcept` compared a proposal in the matcher's form against a stored name in the tree's,
   so "earnings per share" against the stored "earnings per share" FAILED exact and fell through
   to containment — which placed the set's own anchor under a parent that was not in its plan.
   The matcher now normalises both sides; the write step stores new rows under the tree's form
   of the display name and resolves a matched node by its `kltId`.
2. **Naive singular.** "strip the s" gave `synergie`, `taxe`, `analysi`, so "synergy" and
   "synergies" were two keys on the first rebuild. `-ies → -y`, `-xes/-sses → -x/-ss`, `-sis`
   and `-us` kept.
3. **Votes for a topic outside the plan.** A containment placement ("breakeven cost of debt"
   under the vocabulary's "cost of debt") voted for a key no card in the set had named; the
   write had no path for the child. The planner now brings that topic in as a context node under
   the domain, status from the vocabulary.
And one already-known trap: `applyPaths` refuses a path that would re-parent a node the set
already has, so the legacy flat placement (21 depth-0 roots, 10 live links) had to be dropped
first (`--reset-placement`; concepts, links and relations untouched).

**The DAG view is in the editor.** `/sets/[id]/concepts` has a Tree / Dependencies toggle.
`src/lib/klt/dag-layout.ts` (pure, 9 tests): filter → DFS back-edges → longest-path layers →
barycentre ordering (three sweeps) → left-to-right columns; `DagCanvas.tsx` draws it with stroke
width by card count, an arrow per type, min-cards and rolled-edge filters, and FOCUS: the
selected concept's k-hop neighbourhood, because the whole M&A graph is 448 concepts × 491
edges in 10 layers and the first column alone is 200 nodes tall. Selection is shared with the
tree, so the inspector (rename / move / merge / add child) works from either view. On the live
set: "338(h)(10) election" → 4 concepts, 4 edges, 2 layers; it causes buyer step-up benefit and
seller capital-gains treatment, and stock purchase requires it.

**What the tree looks like, honestly.** The top is right — the 34 branches are the M&A
syllabus, the six named parents gather the recurring anchors, and 16 topics are active by
recurrence plus the existing ones. Below that it is still wide and one card deep: 200 nodes at
level 2, 227 at level 3, most of them a single card's leaves. The DAG's cross-card structure is
5 shared edges, all through the roll-up. The rest is the owner's hand — which is what the
editor is for.

Artifact (tree + DAG + cluster names + corpus scoreboard): https://claude.ai/code/artifact/ea6eae09-4f37-402b-ae13-97cdb0bdc374

### The vertical tree — rebuild v2, question type persisted, card modes (2026-09-15, night)

The owner read the first written M&A tree and gave two examples and a principle. "pro forma
EPS" sat under "earnings yield" because four cards each voted a different parent and the tie
went to the earliest card — where pro forma EPS was only the far end of an arrow. "Sources
and uses" sat under "divestiture" because a context voted for the card's anchor, i.e. the
broad concept was filed under the card that mentioned it. The principle: *most of what one
card has should not be a unique node under the domain*. Measured on that tree: 520 of 581
nodes were single-card; 20 of 34 branches under the domain were one card. Every card minted
~7 unique nodes regardless of its question type (define 7.0, scenario 6.6, calculate 4.3,
walkthrough 7.2) — so the type does not explain the width; it explains what KIND of node a
card should make.

**Rebuild v2 (`src/lib/klt/rebuild.ts`, 13 tests), the rules in order:** anchors resolved before
any leaf (so a context can hit an anchor a later card names); weighted `under` votes (3) with ties to
the parent with more cards; contexts point UP (a context that matches an existing node cross-lists
the card's anchor under it); edge endpoints never mint nodes (resolve to a real node directly or
through a label, or the edge is dropped and counted); the NODE BAR — a leaf becomes a node only at
≥2 cards or ≥3 points or an anchor or an *active* existing topic, else it is a LABEL whose points
link to the nearest real ancestor; card MODE; facet-suffix merges by rule (test / analysis /
schedule / process …) and a containment JUDGE (DeepSeek, one batched call per 25 pairs; the survivor
is the node with more evidence, so "accretion/dilution" judged the same as a one-card "dilution"
keeps its name); the chapter SKELETON (one call groups the branches under the domain into ≤10
chapters, names ≤4 words, a chapter needs two members).

**Question type persisted (`CardAuthoring.questionType`, migration `20260915170000`), backfilled
from the run files for 273 of 278 cards** (why 64, compare 44, enumerate 41, define 37,
walkthrough 37, scenario 33, calculate 17). **Card mode (`src/lib/klp/card-mode.ts`)**: define /
why / compare / enumerate → knowledge; calculate → calculation; walkthrough → procedure; scenario →
applied unless mostly quantitative. M&A: knowledge 45, calculation 13, applied 12, procedure 10.
An applied card mints one SKILL node (`Klt.nature`, majority of the cards anchoring there) and
its leaves are labels, with a rank-2 link to any general concept they exercise. The loop now
passes the mode to the minter (`modeInstruction`, optional; the corpus run predates it and was
NOT re-run — the planner applies the mode after the fact).

**M&A, v2, written** (`--judge --chapters --write --reset-placement`, four minutes, four calls):

```
                         v1 (afternoon)     v2 (night)
real nodes               581                105   (+347 point labels)
branches under domain    34 (20 one card)   11 (1 one card)
mean / max depth         2.4 / 6            2.3 / 5
nodes fed by ≥2 cards    ~11%               42%
skills / calculations    —                  9 / 7
KLP links                1,080              759
relations                493 + 146          41 direct + 74 via a label + 38 cross-listings; 405 dropped
judge                    —                  24 pairs: 8 same, 15 related, 1 unrelated
```

The chapters, verbatim from one call: purchase price allocation (goodwill, asset write-up,
deferred revenue, bargain purchase gain, NOLs, gross NOLs, tax deferral); accretion/dilution
(EPS, EPS dilution, accretive acquisition, earnings yield, breakeven cost of debt, foregone
interest, combined equity value); synergy (break-even synergies, synergy distribution, cost
treatment, post-acquisition adjustments, recasting); deal financing (consideration choice,
financing currency, stock refusal, stock-for-stock, sources and uses, debt sizing, debt/EBITDA,
LBO); sell-side process (positioning, buyer universe, inbound offer, fairness opinion, timing);
purchase structure (ownership split, JV, partial exit, divestiture, consolidation); strategic
rationale (merger rationale, value creation, candidate, buyer types, success); acquisition
evaluation (offer price, premium, working capital peg, contribution analysis, sensitivity);
merger vs acquisition (revenue combination, cash flow statement, EBITDA — the weakest). Both of
the owner's examples now read the right way: pro forma EPS sits under accretion/dilution, and
divestiture is cross-listed under sources and uses (which merged with "sources and uses schedule").

**Two defects found by the run.** A cluster or chapter name that matched a member in the OTHER
normal form ("synergy" vs the stored "synergies") created a duplicate parent above its own
member — names are now found in either form. And one "explain to a client" scenario turned
accretion/dilution into a skill — nature is now the majority of the cards anchoring there.

**The tree overlay** draws only cross-listings ("also under", dotted) and edges two or more
cards share; every edge stays in the Dependencies view. The soap card is now one skill node,
"company sale positioning", under the sell-side chapter with nine point labels, and "strategic
buyer" gets its rank-2 link.

**Not done, deliberately:** the corpus was not re-minted with the mode instruction (it would
cost a run and the planner already applies the mode); the other four sets are not written; the
"merger vs acquisition" chapter is the owner's to rename or dissolve.

Artifact v2: https://claude.ai/code/artifact/ea6eae09-4f37-402b-ae13-97cdb0bdc374

### The targeted re-mint and the second chapter pass (2026-09-15, late)

The owner asked why the whole corpus was being re-minted after a prompt change. It should
not have been: the mode line only changes what the minter writes for applied and calculation
cards, and the hard brevity bar only for cards whose proposal carried a >4-word name.
`scripts/remint-subset.ts` lists exactly those — **68 of 278** (M&A 33, Acc-Knowledge 14,
Talking copy 14, Talking 7, LBO 0) — `mint-loop --cards` re-mints them, `scripts/splice-loop.ts`
lays the new fragments over the set's loop file, and the rebuild runs on the spliced file.
~12 minutes and ~$0.10 instead of ~75 minutes.

The soap card failed the schema twice under the first applied instruction: the model did what
it was told — named general concepts (pricing power, horizontal integration, supply chain
resilience) — but as 15 leaves, several with no points. The instruction now says every leaf
still carries its klpRefs and the limit of 10 holds; the card then minted as the skill
"positioning a company for sale" with ten general leaves (revenue diversification, pricing
power, supply chain resilience, strategic buyer, horizontal integration …). `MINT_DEBUG=1`
prints the refused text on the second schema failure, which is how this was found.

The chapter skeleton moved with its input: on the re-minted M&A it grouped 54 branches into 10
chapters but left six singletons under the root that the first run had grouped. A second call
(`ASSIGN_BRANCHES_PROMPT`) now files every leftover into an existing chapter or says null —
"working capital peg" → purchase price allocation, "leveraged buyout" → deal financing.

**Final trees** (real nodes / point labels / chapters / single-card chapters / multi-card share):
M&A 108 / 355 / 12 / 2 / 44%; Accounting-Knowledge 76 / 250 / 14 / 2 / 28%; Talking copy
97 / 288 / 10 / 0 / 27%; Talking 94 / 241 / 11 / 1 / 27%; LBO 10 / 45 / 3 / 0 / 30%. No name
refused by the raised tree cap (6 words / 48 chars) except one on Talking copy. M&A's chapters:
purchase price allocation, accretion/dilution analysis, deal financing, synergies, strategic
rationale, buyer and target landscape, sell-side process, deal structure, valuation inputs,
tax considerations.

### GLM as a grader, a tree summariser and a distractor writer — `npm run bench-models` (2026-09-15)

The owner wants to offer a Z.ai key to users and asked which model is better at the three
runtime jobs a key is routed to: grading written answers, the background concept-tree pass,
and multiple-choice distractors. `scripts/bench-models.ts` runs the PRODUCTION prompts,
schemas and temperatures over the same authored cards with only the model varying; nothing
is written and nothing reaches `AiCallLog`. Scores are substantive: grading = the app's
separation on the stored reference and probes (floor 0.4) plus agreement with the stored
grader; tree = schema, the 3-6-word label rule, concepts per point; MC = structural validity
plus a fixed DeepSeek judge grading each distractor AS AN ANSWER on its own point
("wrongness" = share the judge refuses to mark correct). Six LBO cards, 174 calls, $0.065.

```
GRADING                        sep   ref-agree  latency   USD/18 calls
glm-5.3-flash@low              0.53     98%       3.2s      0.0050
glm-5.3-flash (default)        0.57    100%      30.2s      0.0271   (44.6k reasoning tokens)
deepseek-flash                 0.65     98%       1.4s      0.0028   (off-peak)
gemini-3.1-flash-lite          6/6 failed: "high demand" on the free tier all run

CONCEPT TREE                   schema-fail  label-ok  concepts/pt  latency
glm-5.3-flash@low                  1/6        100%       1.62        3.1s   (one ECONNRESET)
glm-5.3-flash (default)            0/6        100%       1.86       19.3s
deepseek-flash                     0/6         88%       1.35        1.5s
gemini-3.1-flash-lite              3/6        100%       1.10        4.6s

MULTIPLE CHOICE                structural  wrongness  latency   USD/6 calls
glm-5.3-flash@low                 100%        94%       3.5s      0.0017
glm-5.3-flash (default)           100%       100%      37.9s      0.0110
deepseek-flash                    100%        89%       1.6s      0.0019
gemini-3.1-flash-lite             6/6 failed (high demand)
```

**Reading.** As a grader GLM is the weakest again (0.53-0.57 against DeepSeek's 0.65 —
consistent with the 0.44 measured on 2026-09-12), and the default effort buys +0.04 for
10x the latency and 5x the cost; at `low` it is fast and cheap and still separates every
card above the floor. As a **distractor writer it is the best measured**: at `low`, 94% of
its options are judged genuinely wrong on their point against DeepSeek's 89%, at the same
price and 3.5 s. On the tree pass every GLM label obeyed the length rule (DeepSeek 88%) and
it names more concepts per point (1.6-1.9 vs 1.35) — whether the extra concept is signal
or padding is the same question as the extra KLPs in the authoring bench. `reuse` could
not be measured: none of the six authored cards has a live topic link (the concept layer
is orphaned on authored cards — see memory 2026-09-09), so run with `--set` on a legacy
set to get that column. Gemini 3.1-flash-lite failed every grading and MC call with the
free tier's "high demand" message; not a quality result, and why the free tier cannot be
a runtime dependency.

**Recommendation for the shared key:** route `distractors` and `game-pieces` (and `hot-seat`)
to `glm-5.3-flash` at `reasoning_effort: low`; keep `grade` and `diagnostic` on DeepSeek;
`concept-tree` either. Never run GLM at the default effort for a runtime task — 30-40 s a
call and most of the tokens are thinking.

### The owner's build path — key points and topics from the set page (2026-09-16)

The pipeline was operator-only: `author-klps` and `mint-loop` over env keys, a daily cron that
authors six cards on the operator's account, and the legacy one-pass extractor on every save.
Now a set owner has the same pipeline behind one button. `src/lib/klp/generators.ts` builds the
authoring and minting generators over `generateJson` — the owner's credentials, lent keys and the
shared budget — with the role split expressed as TASKS, not model names: writing goes out as
`author` (Z.ai-first by `TASK_PROVIDER_PREFERENCE`), every judging call as `klp-extract`
(DeepSeek-first), minting as `concept-tree`. `src/lib/klp/build-set.ts` runs one bounded step:
author up to 2 cards → mint up to 3 → rebuild the set's tree from the fragments stored on the
cards (`Card.topicProposal` / `topicKlpVersion`, migration `20260916010000`, backfilled for the
276 minted cards) WITHOUT resetting placement. `KeyPointsBuild` on the set page loops the step
until the set reads ready and auto-starts after a save that changed a card (`?build=1`); the cron
uses the same generator and drains topics for the sets it touched. The legacy summariser and
`placeUnparentedConcepts` no longer run on save — they wrote AI-summarised nodes straight into
the owner's tree.

**Measured on the 3-card "Test Set" over env keys (`scripts/build-set.ts`, the operator twin):**
author 2 cards 101 s, author 1 card 62 s, mint 3 cards 19 s, rebuild 11 s → ready. About a minute
and half a cent per card, as the panel says. The stored-credential path could not be exercised
on this machine — `GOOGLE_KEY_ENCRYPTION_SECRET` is not in the local `.env`, so every stored key
fails to decrypt locally ("All 5 AI attempts failed": the aggregate error's `detail.attempts`
says why per credential); it is set in production.
