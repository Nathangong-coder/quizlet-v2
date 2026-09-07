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
