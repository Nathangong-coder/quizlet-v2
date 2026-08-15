# Design system & scope-control redesign

**Date:** 2026-08-15
**Status:** **BUILT 2026-08-15**, all five waves, one commit each (`20c865f` … `e80e88b`), branch
`spec3b-tunable-scoring`, **not merged**. Tests **1311 → 1340** (108 → 112 files), `tsc` clean, lint
**178 → 176**. **Human live gate still owed** — see §8.
**Trigger:** The user's report that "all the filters under profile is way too complicated," widened
at their request to the whole app's visual language.

This document is an **audit first and a design second**, deliberately. Queue item 5 established the
rule the hard way: *"overhaul the UI" is a taste request until it is grounded.* Every finding below
names a file and a line, or a reproducible behaviour. The design section then only proposes changes
that close a named finding — except §4 (visual language), which is an explicit taste decision the
user asked for and which is marked as such.

---

## 1. The filter surface — six findings

### F-1. One concept, four control idioms

`HistoryScope` and `categoryIds` are selected through **four visually different chip controls**:

| Component | Active styling | Semantics | Extras |
| --- | --- | --- | --- |
| `memory/ScopeBar.tsx:20` `Chip` | solid `bg-primary` fill | `aria-pressed` | colour dot, count, "· N sets" |
| `settings/StudyScopePanel.tsx:20` `Choice` | solid `bg-primary` fill | `role="checkbox"` | colour dot, count |
| `sets/CategoryFilterBar.tsx:35` | tinted `${color}20` + coloured text | `aria-pressed` | none |
| `quiz/QuizSetupScreen.tsx:135` | tinted `${color}20` + coloured text | **none** — `<div onClick>` | nested `readOnly` checkbox |

Four controls, three active-state treatments, three accessibility contracts, one of which is absent.
A learner who has toggled a category on `/sets/[id]` then meets a differently-shaped, differently-
coloured control for the same idea in quiz setup and a third on `/profile/memory`.

### F-2. Everything is expanded at once

`ScopeBar` renders, unconditionally and simultaneously: one chip per set, one chip per cross-set
category, an `Uncategorized` chip, one chip per orphaned category key, a `Source` `<select>`, and a
`Card` `<select>`. There is no disclosure of any kind. With 15 sets and 12 categories the filter is
taller than the content it filters. (`progressive-disclosure`, ui-ux-pro-max §8.)

### F-3. A disabled control with an invisible precondition

`ScopeBar.tsx:199-213` — the Card `<select>` is `disabled` unless **exactly one** set is selected.
The precondition is communicated only through a `title` attribute, which never appears on touch and
is not announced. The code's own comment (`scope.ts:44-48`, `memory/page.tsx:264-266`) concedes that
the discoverable path into card scope is clicking a term in the activity feed — so this control is
the redundant half of a pair, and it is the half that is broken by default.

### F-4. A read-only chip row that reads as a filter

`ScopeStats.tsx:62-75` renders a "By mode:" row of `<span>` chips carrying per-source counts. It
sits directly beneath `ScopeBar`'s `Source` `<select>`, which filters that exact dimension. So the
page shows two controls for one dimension and the more prominent one is not a control.

### F-5. Three affordances for one scope on `/profile/learner`

`learner/page.tsx:139-163` stacks: a `defaultApplied` notice containing a "Change it" link, a "Show
everything" button, and then `ScopeBar` displaying the same scope as editable chips. Three ways to
change one value, vertically adjacent.

### F-6. Scope is discarded when moving between profile tabs — a bug

`ProfileNav.tsx:20-22` hardcodes bare hrefs (`/profile/memory`). Both `/profile/memory` and
`/profile/learner` parse the identical `HistoryScope` from the query string. A learner who narrows to
one set on Memory History and clicks "Learner Profile" silently loses the scope and lands on the
saved default. (`state-preservation`, ui-ux-pro-max §9.)

---

## 2. Quiz setup — the roughest surface in the app

`QuizSetupScreen.tsx` is pre-shadcn code that never got revisited. Beyond F-1:

- **G-1. Not keyboard operable.** Both the mode grid (`:80-97`) and the category chips (`:133-152`)
  are `<div onClick>` wrapping a `readOnly` `<input type="checkbox">`. Not focusable, no `role`, no
  `aria-checked`, no `Space`/`Enter` handling. (`keyboard-nav`, `semantic native controls`.)
- **G-2. Hardcoded light-mode colours.** `hover:bg-gray-50`, `border-gray-300` appear 6 times. These
  are literal palette values, not tokens, so they do not respond to theme. (`color-semantic`.)
- **G-3. Raw form controls.** A bare `<select>` and `<input type="number">` styled `rounded border
  p-2`, rather than the project's `Input`/shadcn controls — so they match nothing else in the app.
- **G-4. No validation.** `questionMode` can be emptied to `[]` and "Start Quiz" remains enabled.
- **G-5. "Print Test" silently drops three filters — confirmed bug.** `:198-203` builds
  `?modes=&side=&count=` only. `print/page.tsx:18` types `searchParams` as exactly
  `{ attemptId, modes, side, count }` and `:64` reads **all** cards. So a learner who ticks
  "Starred Only" plus two categories and clicks "Print Test" gets a printable test over the entire
  set, with no indication the filters were ignored.
- **G-6.** Four `as any` casts.

---

## 3. The design tokens — the reason it "doesn't look professional"

### T-1. The design system has no colour at all

Every token in `globals.css` is defined at **zero chroma**: `--primary: oklch(0.205 0 0)`,
`--accent: oklch(0.97 0 0)`, `--chart-1` through `--chart-5` all `oklch(L 0 0)`. The only chromatic
token in either theme is `--destructive`.

This is the root cause of T-2. It is also why the app reads as a wireframe: there is no brand
colour, no accent, and — for a product whose entire purpose is reporting **what you know** — no
visual language for knowledge at all. Mastery, confidence, and severity bands are all rendered as
text.

### T-2. 149 ad-hoc palette colours, in 7 files with theme-breaking greys

Because there is no accent token, pages reach for raw Tailwind palette values. `grep` across `src`
finds **149** occurrences of `(text|bg|border)-(gray|blue|green|…)-\d+`. The top entries are
`border-gray-300` (11), `border-gray-200` (11), `text-gray-500` (8), `bg-gray-50` (8),
`bg-gray-100` (8). The neutral ones are hardcoded light-mode values across **7 files**.

`profile/page.tsx:87,98,109` is the clean illustration: three stat tiles coloured
`text-yellow-500` / `text-blue-500` / `text-green-500` — three hues carrying no meaning, chosen per
tile, none of them a token.

### T-3. Dark mode is defined but unreachable, and would break if reached

`.dark` is fully specified in `globals.css:86-118`, but **nothing ever applies the class**: there is
no `next-themes`, no `ThemeProvider`, no toggle anywhere in `src`. It is dead code — and the 7 files
in T-2 would render broken if it were switched on.

### T-4. Two token defects

- `--sidebar-accent: oklch(0.97 0 0)` against `--sidebar-accent-foreground: oklch(0.985 0 0)` — a
  contrast ratio of roughly **1.06:1**, in *both* themes. Unused today; broken the moment it is used.
- `--font-mono: var(--font-geist-mono)` (`:11`) references a variable that is **never defined**, so
  every `font-mono` in the app silently falls back to the browser default.

### T-5. One typeface for everything

`layout.tsx:7` loads `Inter` and `globals.css:12` sets `--font-heading: var(--font-sans)` — headings
and body are the same face at the same width. All hierarchy is carried by size and weight alone. The
app's dominant content is **numbers** (confidence 1–10, pKnown, percentages, counts) and there is no
tabular-figure treatment beyond a few ad-hoc `tabular-nums` classes.

---

## 4. Design direction — "Ledger"

**This section is a taste decision, unlike §1–§3.** The typeface and accent hue were the two calls
needing the user's assent; **both were confirmed on 2026-08-15** — "Ledger" was chosen over a
mono-forward "Terminal" and a high-contrast "Broadsheet" alternative, and the build order was
confirmed as waves 1→5 in sequence.

The product is finance interview preparation, and its distinguishing feature is that it keeps an
honest longitudinal record of what you know. The aesthetic should read as **instrument, not toy**:
editorial, precise, data-forward, one decisive accent. Not glassmorphism, not playful, not the
purple-gradient default the `frontend-design` skill explicitly warns against.

### 4.1 Type

| Role | Face | Why |
| --- | --- | --- |
| Display / headings | **Fraunces** (variable, optical size) | A serif with real character; reads editorial and serious rather than generic. Gives hierarchy that isn't just "same font, bigger". |
| Body / UI | **IBM Plex Sans** | Neutral, workmanlike, excellent at small sizes; pairs with a mono of the same family. |
| Metrics / data | **IBM Plex Mono**, `tabular-nums` | Every confidence score, posterior, percentage and count. Fixes T-4's dead `--font-mono` and makes columns stop shifting. |

### 4.2 Colour

Three additions, all as tokens — no raw palette values in components.

1. **One accent.** A deep ink-indigo, roughly `oklch(0.45 0.14 265)` light / `oklch(0.72 0.13 265)`
   dark. Replaces the achromatic `--primary`. Sparing use: primary actions, active nav, active chips.
2. **A knowledge ramp** — `--know-0` … `--know-4`, a *sequential* scale (not categorical), because
   mastery/confidence/pKnown are ordered quantities. This is what finally gives the app a visual
   language for its own subject matter, and what makes `--chart-1..5` real instead of five greys.
3. **A severity scale** for Spec 3B's bands — ordinal, colour **plus** icon or label, never colour
   alone (`color-not-only`).

### 4.3 Dark mode becomes real

Add `next-themes` + a toggle, convert the 7 T-2 files to tokens, and fix T-4's contrast pair. Dark
mode is already 90% written; it just needs to be reachable and not broken.

---

## 5. The scope control

**One scope line, not a scope panel.** Collapsed by default; the current state is always readable
without opening anything.

```
Showing   [ All sets ▾ ]  [ All categories ▾ ]                        1,204 answers

Showing   [ Finance ▾ ]  [ valuation ×] [+2 ×]   Clear                  312 answers

Showing   [ Finance ▾ ]  [ 3 categories ▾ ]   Saved scope · Show everything · Edit default
```

- Two **popover dropdowns** with searchable checkbox lists. Closes F-2: 30 sets becomes a scrollable
  searchable list rather than 30 chips.
- Selections render as **removable chips inline**, capped at 3 plus an overflow count.
- **The Card `<select>` is deleted** (F-3). Card scope is entered by clicking a term in the feed —
  already the working, documented path — and exited via the `×` on its chip.
- **`Source` stops being scope** (F-4). It becomes a view control on the Memory History feed, and the
  "By mode" count chips *become* that control: clickable, with the counts as their own
  discoverability. It is removed entirely from `/profile/learner` — "show my knowledge model but
  counting only true/false answers" is not a question a learner asks, and it silently halves every
  posterior it touches.
- **The saved-scope notices fold into the line** (F-5). The amber `widened` banner stays a banner;
  that one is an error state, not a control.
- **`ProfileNav` threads the scope** through its hrefs (F-6).

### 5.1 The Settings panel loses its checkbox

`StudyScopePanel`'s "Only test certain sets" checkbox exists to distinguish *ticked-and-empty* from
*unticked* — and the panel then has to **detect and block** that state (`emptySets`,
`emptyCategories`, `blocked`, `:103-105`), because `[]` already means "everything" in storage and
saving it would persist the opposite of what the panel displays.

A control whose only additional state is invalid should not exist. Dropping it makes empty selection
read as "All sets", which is honest, unblockable, and matches the stored zero value — and deletes the
block logic outright. The panel then renders the **same two dropdowns** as the scope line, closing
F-1 for the settings/profile pair.

---

## 6. Build order

Each wave is independently shippable and independently verifiable.

| Wave | Content | Closes |
| --- | --- | --- |
| **1. Tokens** | Accent, knowledge ramp, severity scale, fonts, `--font-mono` fix, `--sidebar-accent` contrast fix. No component changes. | T-1, T-4, T-5 |
| **2. De-hardcode** | Convert the 149 ad-hoc colours to tokens; add `next-themes` + toggle; verify both themes. | T-2, T-3 |
| **3. One chip** | A single `SelectableChip` primitive; `ScopeBar`, `StudyScopePanel`, `CategoryFilterBar`, `QuizSetupScreen` all adopt it. | F-1 |
| **4. Scope line** | The collapsed popover control; delete the Card select; move Source to the feed; fold the notices; thread `ProfileNav`. | F-2 – F-6 |
| **5. Quiz setup** | Rebuild on shadcn controls, keyboard-operable, validated, and **carry the filters into Print Test**. | G-1 – G-6 |

Waves 1–2 are mechanical and low-risk. Wave 4 carries the most test churn. Wave 5 contains the one
confirmed functional bug (G-5) and could be pulled forward if that matters more than the visuals.

---

## 7. What the build found that the design did not

Four things worth more than the diff:

1. **The card chip could still be hidden.** §5 said the card chip must survive the overflow cap; the
   first implementation merely put it *last* and ran `slice(0, MAX_VISIBLE_CHIPS)`, which drops it
   as soon as four other narrowings exist — hiding the narrowest scope, the one actually deciding
   what the page shows. Caught by writing the test that was supposed to prove the claim. It is now
   an explicit `pinned` flag, and reverting the pin reddens that test.

2. **A guard that could not fail, again — the third in this repo.** `nextTheme`'s
   `if (index === -1) return MODES[0]` was redundant: `(-1 + 1) % 3` is already `0`. Deleted rather
   than kept, matching the calls made on Spec 3C's 600-char reserve and item 5's null-average
   ternary. The lesson is now reliable enough to state as a rule: **when a mutant survives, check
   whether the branch is reachable before concluding the test is weak.**

3. **The build caught what review did not.** `ProfileNav` gaining `useSearchParams` made `/profile`
   fail prerender with a CSR-bailout error. The two sibling pages already had a Suspense boundary;
   this one had never needed one.

4. **A test forced a real accessibility fix.** `MultiSelect` options announced as "accounting 12"
   because the count was not `aria-hidden`. Found because a role-based query could not match the
   option, not by inspection.

## 8. Human gate still owed

Trap 6: no signed-in page is reachable from an agent session. Everything below needs the browser.

- **Dark mode.** Toggle through system → light → dark on `/sets`, a set detail page, a quiz, the
  matching game, and all three profile pages. The 7 previously-hardcoded files are the risk.
- **The scope line.** Both dropdowns open, filter, and collapse; the trigger reports the selection;
  chips remove individually; `Clear` appears only when scoped.
- **Scope survives a tab change** — narrow on Memory History, click Learner Profile, confirm the
  same scope is applied and that Overview's link carries none.
- **The by-mode chips filter the feed**, and clicking the active one clears it.
- **`/settings/ai`** still saves each of the four panels independently (Spec 3B's partial-save
  contract) now that Study scope has no checkbox.
- **Print Test with filters on** — tick Starred Only plus a category, print, and confirm the test
  contains only those cards. This is the one confirmed functional bug; the URL half is unit-tested,
  the page half is a server component with no test.

## 9. Out of scope

- The set detail, review, and matching surfaces get token conversion in Wave 2 but no structural
  redesign. If they need one, audit them separately rather than folding it in here.
- Spec 4 (BUILD-QUEUE item 6) adds a third scope picker (`inputScope`). It should be built **on the
  Wave 4 control**, not before it — that is the main argument for doing this work now rather than
  after Spec 4.
