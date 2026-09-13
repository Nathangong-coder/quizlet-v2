# Model performance

**A running record of which models and configurations can actually do this
app's work, measured rather than assumed.**

Last run: 2026-09-06.

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
