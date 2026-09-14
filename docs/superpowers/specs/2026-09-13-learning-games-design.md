# Learning games — design

**Date:** 2026-09-13 · **Status:** **BUILT 2026-09-13** (sub-project 6 of 6 on `study-platform`); **live gate owed** — see §8
**Migration:** `20260913150000_game_pieces` (applied to the dev database 2026-09-13)
**Builds on:** `2026-08-01-klp-question-generation-design.md` (KLPs), `src/lib/klp/reuse.ts`
(exact-hash reuse), `2026-08-27-public-sets-and-discovery-design.md` (`readableSetWhere`)
**Consumed by:** the landing page revamp (sub-project 2) advertises these four games by name;
sub-project 6 builds them.

## §0 Decisions taken with the owner

1. **Games are for fun. They write no study memory.** No `QuizAnswer`, `StudyEvent`,
   `ConfidenceEvent`, `KlpState` or any other history row is written by any game, ever. A test
   asserts this against the Prisma mock (§6) so the guarantee is a build failure, not a comment.
   *Narrowed 2026-09-13 (§9):* the one thing a game writes is a **`GameScore`** leaderboard row,
   which is not memory — nothing reads it back into confidence, mastery or a plan — and only for
   a signed-in player with a handle. An anonymous run is simply not saved.
2. **One game reads memory, the rest are blind.** Gauntlet reads the viewer's confidence and
   KLP state to order its run (read only). Hot Seat, Blitz and Crossword see the set's content
   and subject and nothing about the learner.
3. **Short atoms come from key points, not cards.** Finance-style cards have paragraph-length
   definitions that no tile, block or crossword cell can hold. A *game piece* is a short
   prompt/answer pair derived from a single KLP (or, for vocabulary-shaped cards, from the card
   itself). Blitz, Crossword and the pieces variant of Match consume pieces; Gauntlet and Hot
   Seat consume whole cards.
4. **Pieces are prepared by the owner, on a button, with the owner's credentials.** Not on card
   edit (spends quota on sets nobody plays) and not on first launch (a public-set player
   would pay for the owner's set). A public-set player finds the games greyed out until the
   owner prepares them; that is accepted.
5. **Pieces are reused across identical cards** on `Card.klpSourceHash`, exact match only, for
   the reason `src/lib/klp/reuse.ts` gives: a piece copied onto a card it does not describe is
   wrong some fraction of the time with no way to tell which fraction.
6. **Games run client-side.** Each game is a pure reducer; the server exists only to prepare
   pieces, plan a Gauntlet run, grade a typed answer, and write a Hot Seat probe. No session
   rows. A reload mid-run loses the run. Best scores live in `localStorage`.
7. **Gauntlet and Hot Seat warn before spending.** Both launch screens say that typed answers
   are graded with the learner's own AI credentials and roughly how many calls a run makes;
   Gauntlet additionally says the run is built from what the learner is weakest on.

## §1 The game piece layer

### §1.1 Model

```prisma
model GamePiece {
  id         String   @id @default(cuid())
  cardId     String
  card       Card     @relation(fields: [cardId], references: [id], onDelete: Cascade)
  /// Denormalised so a set's whole pool is one query. Cascade follows the card.
  setId      String
  /// NULL when the piece is the card's own term/definition (`kind = term`).
  klpId      String?
  /// Pieces retire with their KLPs. A card whose `klpVersion` has moved on has
  /// its older pieces IGNORED, never deleted — the same versioning rule as
  /// `CardKlp`, and for the same reason: history stays truthful.
  klpVersion Int
  /// `Card.klpSourceHash` at generation time. The reuse key (§1.3).
  sourceHash String
  /// term | cloze — vocabulary in src/lib/games/pieces.ts
  kind       String
  /// "WACC stands for ___"   /   the definition, for `term`
  prompt     String   @db.Text
  /// "weighted average cost of capital"   /   the term, for `term`
  answer     String
  /// Alternative spellings accepted by typed games: ["WACC", "weighted avg cost of capital"]
  aliases    Json     @default("[]")
  enabled    Boolean  @default(true)
  /// Model attribution, same rule as every other AI artifact: NULL for a
  /// deterministic `term` piece; a COPIED piece carries the donor's model,
  /// because that is who wrote it.
  model      String?
  createdAt  DateTime @default(now())

  @@index([setId, klpVersion])
  @@index([sourceHash])
}
```

### §1.2 Derivation (`src/lib/games/pieces.ts`, pure)

- `isShortCard(card)`: term ≤ 3 words **and** definition ≤ 12 words. Such a card yields exactly
  one `term` piece — `prompt = definition`, `answer = term`, no AI call.
- Every other card yields 0–n `cloze` pieces, one per live KLP at most, from the
  `make-game-pieces` prompt (registered and versioned in `src/lib/ai/prompts/registry.ts`,
  batched ~10 KLPs per call, `maxOutputTokens` set — see the reasoning-tokens memory). The
  schema per KLP: `{ klpIndex, prompt (exactly one "___"), answer (1–4 words), aliases[] }` or
  nothing. A KLP with no clean short answer — most pure-mechanism sentences — returns nothing,
  and that is the correct output; a bad piece is worse than no piece. Zod-validated; a reply
  whose `prompt` lacks a blank or whose answer exceeds 4 words is dropped, not repaired.
- `normalizeAnswer(s)`: lowercase, strip punctuation, drop leading articles, collapse
  whitespace. One function, used by every typed comparison in every game.
- `isCrosswordSafe(piece)`: `normalizeAnswer(answer)` with spaces removed is 3–12 letters
  `[a-z]`. Multi-word answers are allowed (spaces removed in the grid, as real crosswords do).

### §1.3 Prepare games (`prepareGamePieces(setId)`, server action, owner only)

Owner check follows `setSetVisibility` in `src/actions/sets.ts` (session, then the set's
`userId` equals the caller). Spends the **owner's** credentials via `generateJson`. Per card:

1. Live pieces exist for the card's current `klpVersion` → **skip**.
2. Else a donor exists — any card with the same `klpSourceHash` that has live pieces
   (`findPieceDonors`, mirroring `findDonors` in `src/lib/klp/reuse.ts`; prefer the donor
   with the most enabled pieces) → **copy**: new rows on this card, `klpId` remapped by KLP
   `index`, `model` carried from the donor. Cards in the same set are valid donors too.
3. Else `isShortCard` → **make** the `term` piece with no call.
4. Else `klpStatus = ready` → **generate** clozes.
5. Else → **skip** with the reason (`no_klps`).

Returns `{ made, copied, generated, skipped: {cardId, reason}[], failed: {cardId, kind}[] }`.
Idempotent: a second run touches only cards whose version moved. The most recent summary is
stored on the set (`Set.gamesPreparedAt DateTime?`, `Set.gamesPrepareSummary Json?`) so the
hub can show "Prepared 12 Sep · 41 pieces · 3 cards skipped" without recomputing.

### §1.4 Availability (`gameAvailability(pieces, cards)`, pure)

| game | needs |
|---|---|
| Blitz | ≥ 8 enabled pieces |
| Crossword | ≥ 10 enabled crossword-safe pieces |
| Match (pieces variant) | ≥ 6 enabled pieces |
| Gauntlet | ≥ 5 cards with `klpStatus = ready`, and a signed-in viewer |
| Hot Seat | ≥ 5 cards with `klpStatus = ready`, and a signed-in viewer |

Returns, per game, `playable | { reason: 'needs_pieces', short: n } | 'no_klps' | 'sign_in'`.

### §1.5 The pieces view (`/sets/[id]/games/pieces`)

Pieces grouped by card, each row showing the source KLP text, the prompt, the answer, the
aliases and an enable toggle (owner only; `setGamePieceEnabled(pieceId, enabled)`, owner
check on the piece's set). Readers of a link/public set can view. A second section lists cards
that produced nothing and why (`no_klps` / `no clean short answer` / `failed`).

## §2 The games

Every game is `src/lib/games/<game>.ts` exporting `create(config, seed)`, `reduce(state,
action)` and selectors; a seeded PRNG (`src/lib/games/rng.ts`, mulberry32) makes a run
reproducible. A React component in `src/components/games/` owns the reducer state and the
timers. Best scores: `localStorage['games:<game>:<setId>']`, read/written inside try/catch.

### §2.1 Gauntlet — the memory reader

**Launch screen** states: *this run is built from the cards you're weakest on*; *typed rooms
are graded with your AI credentials (about N calls)*. A **Multiple choice only** toggle removes
every AI call.

**`buildGauntletRun(setId, { mcOnly })`** (server, signed-in, set readable): reads
`CardProgress` and `KlpState` for the viewer and the set's cards, calls the pure
`planRun(cards, memory, seed, { mcOnly })`, and returns rooms with card content and MC options.
Correct answers for typed rooms are never sent to the client.

**`planRun`** assigns each card a room type from memory:

| room | rule | format | hits |
|---|---|---|---|
| corridor | confidence ≥ 7 and not due | MC (cached distractors; deterministic fallback of other cards' terms) | 1 |
| door | confidence 4–6, or due | typed (MC in `mcOnly`) | 1 |
| boss | the 3 lowest-confidence cards | typed (MC in `mcOnly`), def→term then term→def | 2 |

A viewer with no memory on the set gets corridors only and the launch screen says so. Order:
corridors and doors shuffled by seed, bosses last, worst boss final.

**Reducer**: 3 lives; streak; a shield every 5-streak absorbing one miss; a miss costs a
life and re-queues the room once; death or the final boss ends the run with `{ roomsCleared,
bossesBeaten, elapsedMs, bestStreak }`.

**Typed grading**: `gradeGameAnswer(cardId, answer)` → `{ hit, verdicts: {klpId, status}[] }`
from the existing `grade-short-answer` prompt. `hit` is computed in TypeScript: every
substance KLP with weight ≥ 4 is `hit`. No row is written.

### §2.2 Hot Seat — the short-answer game

**Persona** by `Set.subject` (sub-project 3; a default `examiner` persona until then), from a
static table in `src/lib/games/personas.ts`: name, one-line vibe, opening line, probe style.
Finance → superday interviewer; history → oral examiner; language → conversation partner;
science → viva panellist; default → examiner.

**Run**: five cards sampled uniformly (seeded) from cards with ready KLPs. Launch screen carries
the credential note (≈ 5–10 calls). Per question a soft 90 s countdown: at zero the mood ticks
down 5 and the answer is still accepted. Mood starts 50, clamped 0–100, moves + Σ weight of
hit KLPs, − Σ weight of missed KLPs.

**Probe**: on a miss, `probeHotSeat(cardId, missedKlpId, answer)` writes one in-persona
follow-up aimed at that point (`hot-seat-probe` prompt, registered). The learner gets one
reply, graded against that single KLP through `gradeGameAnswer` with a `klpIds` restriction.
A recovered probe restores half the mood lost on that question. One probe per question.

**End**: verdict from final mood — `callback` ≥ 65, `maybe` 40–64, `no callback` < 40 — and a
transcript (question, answer, verdicts, probe, reply) in component state with a copy button.

### §2.3 Blitz — arcade, pieces, no AI

Four lanes. A piece's prompt falls over `fallMs` (6000 start, ×0.94 every 5 clears, floor
2200). Four answer tiles: the correct answer and three from other pieces whose normalised
answers differ. Correct → clear, `+10 × combo`; wrong → remaining fall time cut to 30 %;
landing → strike; three strikes end the game. Three consecutive clears → combo ×2 and a
1.5 s freeze. The reducer is tick-driven (`{ type: 'tick', now }`), so the whole game runs
under fake time in tests.

### §2.4 Crossword — pieces, no AI

`layoutCrossword(pieces, seed)` (pure): take up to 20 crossword-safe pieces, longest first;
place the first across at centre; place each next word at the crossing that maximises
intersections while creating no adjacent-parallel runs; up to 15×15; if fewer than 10 words
place, retry with the next seeded order (3 attempts) and otherwise return `null`. Output:
grid cells, numbered across/down clues (the piece prompts).

Play: click a cell, type; arrows move; Tab switches direction; a word turns green when its
normalised letters match; **Check** marks wrong letters; **Reveal word** adds 30 s to the
timer. Print view reuses the existing print styles.

## §3 Routes, tiles, access

Under `src/app/sets/[id]/`, beside `match` / `quiz` / `review`:

- `games/` — the **hub**: one card per game (pitch, availability from §1.4, credential note
  for Gauntlet and Hot Seat); for the owner, **Prepare games** with the last summary.
- `games/gauntlet`, `games/hot-seat`, `games/blitz`, `games/crossword`, `games/pieces`.

**Activity tiles**: the "Matching Game" tile becomes **Games** → `/sets/[id]/games`. Match
stays reachable from the hub and at its old route; nothing is stranded. Three tiles remain.

**Match on pieces**: `/sets/[id]/match?source=pieces` maps pieces to `{ left: prompt, right:
answer }` through a small adapter; offered by the hub only when ≥ 6 pieces.

**Access**: every games page spreads `readableSetWhere(viewerId)`. Gauntlet and Hot Seat
require sign-in. `prepareGamePieces` and `setGamePieceEnabled` are owner-only.
`gradeGameAnswer` and `probeHotSeat` require the set to be readable by the caller and run on
the caller's credentials through `generateJson`, so the pool's rotation and classification
apply unchanged.

**No-credential path**: `no_credentials` / `credentials_unavailable` from the first typed
room flips a Gauntlet run to MC-only with a toast; Hot Seat refuses at launch with a link to
`/settings/ai`.

## §4 Prompts

Two new entries in the registry, each with a test pinning registration and version:

- `make-game-pieces` v1 — input: card term, definition, numbered KLPs; output per KLP as §1.2.
  The prompt names the two piece kinds and the one-blank rule explicitly (the closed-vocabulary
  memory: TypeScript drops what the prompt did not name).
- `hot-seat-probe` v1 — input: persona, card, the missed KLP text, the learner's answer;
  output `{ question }` — one sentence, in persona, that can be answered by stating the point.

## §5 Error handling

- A failed generation batch marks its cards `failed` in the summary; the run continues; the
  hub offers **Prepare again**, which retries only `failed` cards.
- Mid-game AI failure surfaces the classified `FailureKind.user`/`system` message and degrades
  as §3 says. A game never stalls on a failed call.
- `layoutCrossword` returning `null` shows "not enough short answers yet", never a sparse grid.
- `localStorage` unavailable → no best score, game still plays.

## §6 Tests (`tests/games/`)

- `pieces.test.ts` — short card → one `term` piece, no call; long card → clozes only from live
  KLPs; a "nothing" reply yields nothing; `normalizeAnswer`; `isCrosswordSafe`.
- `prepare.test.ts` — donor copy remaps `klpId` and carries `model`; version bump hides old
  pieces without deleting; second run makes zero calls; non-owner refused.
- `gauntlet.test.ts` — `planRun` room assignment from a fixture memory; no-memory viewer →
  corridors only; `mcOnly` never yields a typed room; lives, shield, re-queue once, death,
  final boss; correct answers absent from the typed-room payload.
- `hot-seat.test.ts` — mood arithmetic and clamps; timeout still accepts; one probe max;
  recovery restores half; verdict thresholds.
- `blitz.test.ts` — under fake time: ramp and floor, wrong-tap cut, strike on landing, combo
  and freeze, no two tiles share a normalised answer.
- `crossword.test.ts` — every word on a valid crossing; no adjacent-parallel runs; ≤ 15×15;
  ≥ 10 words on the fixture; seed determinism; `null` on a thin pool; check/reveal.
- `access.test.ts` — unreadable set refused by all four actions; owner-only actions refuse a
  reader; **`gradeGameAnswer` and `probeHotSeat` perform no `create`/`update`/`upsert` on
  any model** (asserted on the mock).
- Registry test extended for the two prompts.

## §7 Out of scope

Multiplayer and leaderboards; any persistence of runs or scores; editing a piece's text
(toggle only); speech input for Hot Seat (Stage 4); personas beyond the static table; changing
Match's own card-pair source; showing game activity in study groups (sub-project 5 may
revisit, but only as "played", never as evidence).

## §8 As built — departures from the design above, and the live gate

- **Match now writes nothing too** (owner's call, same day, on being told it recorded a
  `StudySession` + `StudyEvent`s: "it was a bad call to have it at the start"). The session
  plumbing and `submitMatchSession` are deleted, `/match` left the sign-in middleware (nothing to
  protect), and a device-local best time replaced the record. `?source=pieces` is the pieces
  variant from §3, offered on the hub when ≥ 6 pieces exist. `tests/games/match-writes-nothing.test.ts`
  scans the component, the page and the middleware.
- **Gauntlet corridors use deterministic MC options** (other cards' terms/definitions), never
  the cached AI distractors: the distractor cache is keyed per model and reading it would tie
  a zero-AI mode to the credential pool. MC-only Gauntlet therefore makes zero calls, as §2.1
  promised.
- **`MAX_ANSWER_WORDS` is 5, not 4** — the canonical example ("weighted average cost of
  capital") is five words.
- **A boss whose card has no memory cannot exist**: bosses are the lowest-confidence cards
  *with* a progress row; unstudied cards are corridors (nothing says they are weak).
- **Hit rule** (`isHit`, `src/actions/games.ts`): every substance point with weight ≥ 4
  `passed`; framing points (`CardKlp.role = framing`) are excluded. A card with no heavy
  substance points is a hit when nothing failed.
- **Best scores** go through `useBest` (`useSyncExternalStore` over `localStorage`, server
  snapshot null) so SSR and the first client render agree.
- **Pieces are generated under the `distractors` task** (the closest existing routing task;
  no new `AiTask` was added). The two prompts are `make-game-pieces` v1 and `hot-seat-probe`
  v1 in the registry.

**Live gate owed.** The reducers, the prepare/donor/skip paths, the no-writes guarantee, and
the page access rules are tested; the hub, pieces page and the signed-out game pages were
rendered in a browser. Not yet walked with a signed-in owner: **Prepare games** on a real set
(a real `make-game-pieces` call), a Blitz and Crossword round on real pieces, a Gauntlet run
with typed rooms, and a full Hot Seat interview with a probe. Walk those once.

## §9 Revamp, 2026-09-13 (same day, owner's brief after playing the first cut)

The owner's verdict on the first build: Gauntlet was "82 obstacles", the games had no
characters and no shared leaderboards, Hot Seat listed the missed points (spoiling the
interview), and Match dealt whole cards. This section is what shipped in reply; where it
contradicts §2, §9 wins.

### §9.1 Leaderboards — `GameScore`, the one write

`GameScore { game, mode, setId, userId, score Int, meta Json?, createdAt }`, indexed on
`(setId, game, mode, score)`. One convention: **higher is better**, so time-based boards store
milliseconds **negated** (`timeToScore`) and one `ORDER BY score DESC` serves every board;
`formatScore` reads it back as `m:ss.t`. `rankScores` (`src/lib/games/scores.ts`, pure) keeps
the best row per player, shares ranks on ties (earlier run wins the tiebreak), drops rows with
no handle, caps at 20. `submitGameScore` (server action) is the only writer: anonymous →
`{ saved: false, reason: 'anonymous' }`, no handle → `reason: 'no_handle'` (both **successes**,
the UI just says so), unknown game/mode or an implausible score (`SCORE_BOUNDS`) → error, set
must be readable by the viewer. Boards are per set and per mode: Gauntlet `mc | sa`, Hot Seat
`easy | normal | hard`, Blitz / Crossword / Match `default`. Every game page renders its
board(s) beside the game; the hub renders all eight compact.

### §9.2 Sprites — on-brand pixel art, no raster assets

`src/lib/games/sprites.ts` holds every character as a text grid (one char per pixel, `.`
transparent, colours from `PALETTE` — the app's indigo and cream); `PixelSprite` renders it as
SVG rects with `crispEdges`. `compose(base, ...overlays)` layers costumes and faces. The cast:
knight (+ shield with the synapse mark), slime, imp, dark knight, boss, magician, and the Hot
Seat host with five **faces** (neutral / pleased / skeptical / annoyed / impressed) and a
**costume per subject group** (business-finance "The panel", science "The scientist",
arts-humanities "The author", maths "The professor", medicine-health "The attending",
technology "The interviewer", default "The examiner"). `scripts/sprite-sheet.ts` prints the
cast as one HTML page for eyeballing. A test pins every sprite rectangular and on-palette.

### §9.3 Gauntlet — a knight, 100 HP, twelve enemies, a magician

Replaces §2.1's rooms. `planRun({ cards, memory, seed, mode })` builds **twelve encounters**
in a fixed shape (`RUN_SHAPE`: slimes and imps first, dark knights, a miniboss, champions, the
**boss last**); the viewer's least-confident cards take the boss and champion slots (a due card
counts as weak; an unstudied card sits at 5), a set with fewer than twelve cards repeats. Reading
`CardProgress` here is still the only memory read any game makes.

The reducer: **`MAX_HP = 100`, no lives.** A hit strikes the enemy (slime/imp 1 hit, dark
knight/miniboss 2, **boss 3** — a progress bar shows hits left); a miss costs the enemy's damage
(8 → 12 → 16 → 20 → 25, ramping by enemy) and resets the streak. Zero HP is `dead`. Kill points
(50 → 400) carry a streak bonus (+10 % per streak, capped at 2×); the final score adds the HP
left and a speed bonus (`max(0, 300 − seconds)`). **Every third kill the magician appears** with
a choice: **heal 15 HP** or **weaken the next enemy** (it hits for half, and a 2- or 3-hit enemy
falls one hit sooner).

Two modes, chosen on the launch screen. **Multiple choice** (`mc`): `gauntletOptions(cardId, ask)`
returns four options; on the definition side the wrong three are **AI-written distractors**
(the `MULTIPLE_CHOICE_PROMPT`, cached in `QuizOptionCache` per `(card, model)` so a card is
paid for once for everyone), on the term side and whenever no credential is usable it falls back
to sibling cards' text and says so. **Short answer** (`sa`): the player types, `gradeGameAnswer`
grades against the key points, and the **weighted share of points earned is the chance to hit**
(`accuracy` — passed = 1, partial = ½), rolled in the open and shown as a small "N % to hit" tag.
The roll is taken at the event boundary and passed into the reducer, so the reducer stays pure
under fake time.

### §9.4 Hot Seat — a face, three difficulties, and no spoilers

Three modes (`HOT_SEAT_MODES`): **easy 4 rounds** (patience decay ×0.7, recovery ×0.5),
**normal 5** (×1, ×0.5), **hard 7** (×1.5, ×0.25) — more rounds are reserved for the harder
modes, and hard both loses mood faster and recovers less. The clock stays **90 s per question**.
The host is the sprite host in the set's subject costume; `faceFor(verdicts)` picks the face
from the share of points earned (≥ 0.99 impressed, ≥ 0.7 pleased, ≥ 0.4 skeptical, else
annoyed) and the face is the **only** per-answer feedback during the interview: **the missed
key points are never listed** — the player sees the host's reaction and the follow-up question.
Points appear only in the end-screen transcript. The verdict submits the final mood (0–100) to
the mode's board.

### §9.5 Blitz and Crossword

Unchanged as games; both submit to their board at the end (Blitz the score, Crossword the
solve time negated) and show "Saved to the leaderboard." or the handle hint.

### §9.6 Match — pieces only, sixteen tiles, a timer, fastest time

`/sets/[id]/match` is **deactivated until the set has eight pieces** (`MIN_PIECES.match = 8`;
the page says so and points at the hub, where the owner prepares them). It deals **eight pairs
from pieces** (`dealMatch`, seeded) — never whole cards, which is what made the finance boards
unplayable — onto a 4 × 4 grid sized to fit one screen (`MatchTileCard`: fixed 4 : 3 aspect,
text clamped to four lines). The seed comes from the server per request and the shuffle and
tile ids derive from it (`initMatchGame(cards, id, rng)`), so the SSR board and the hydrated
board are the same board; "Play again" re-deals from a fresh seed without a reload. Finishing
submits the time to the "Fastest times" board. The old cards-based Match and the
`?source=pieces` variant are gone; the source-scan guard now allows exactly one server-action
import in the Match files, `submitGameScore`.

### §9.7 Verified

`tests/games/` (76 tests): plan shape and weakest-last ordering, HP damage ramp, death, streak
points, the magician's two choices, boss hits, `rollHit`, the SA accuracy, Hot Seat modes and
`faceFor`, leaderboard ranking and time encoding (including that `timeToScore(0)` is `0`, not
`-0`), score bounds, `submitGameScore`'s anonymous / no-handle / bounds / unreadable paths, the
sprite grids, `dealMatch`, the deterministic Match deal, and component tests that pin the knight
and enemy on screen, the HP bar with no lives, the magician's buttons, the SA "% to hit" tag,
the host's face reacting, the follow-up appearing, and the missed point **absent** from the
DOM. Browser (anonymous): Match on the M&A set — sixteen tiles, no scroll, timer, finish
modal, re-deal; Blitz and Crossword start; hub with eight empty boards. Two hydration
mismatches were found and fixed in the browser (Match's unseeded shuffle and Crossword's
client-side seed) — the kind of defect jsdom cannot see.

**Live gate owed (signed in):** a Gauntlet run in each mode on a real set (AI distractors
generated and cached; a short-answer roll), a Hot Seat interview in each difficulty with a
probe, and one score of each kind landing on a board with the player's handle.
