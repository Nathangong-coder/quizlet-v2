# Feature pages and the seven-tab showcase — design

**Date:** 2026-09-13 · **Status:** built on `study-platform` (sub-project 2 of 6)
**Builds on:** `src/components/home/FeatureShowcase.tsx` (commit `f16ab26`),
`2026-09-13-learning-games-design.md` (the four games the Games page names)

## §0 What the owner asked for

Quizlet's `/features/<name>` pages — a hero with a headline, three icon-bulleted benefits, a
call to action and a large mock on a coloured slab; then two or three zig-zag sections; then
a closing call — for seven features: **Flashcards, Learn, Study guides, Postmortems, Test,
Review, Learning games.** Learn and Study guides are not built and are described as they
will look; Games names the four designed games and says Match is what plays today.

## §1 Shape

- **`src/lib/marketing/features.ts`** — plain data, no React beyond icon components. Seven
  `Feature`s in the owner's order: `slug`, `label`, `icon`, `status: 'live' | 'coming'`,
  optional `badge` (Games: "Match today · 4 more coming"), `claim`, `body`, exactly three
  `benefits`, two to four `sections` (`title`, `body`, `mock`, optional `link`), and a
  `heroMock`. Mocks are referenced by id string.
- **`src/components/marketing/mocks.tsx`** — every drawn panel, keyed by `MockId`. The six
  panels the showcase already had move here unchanged (short answer, key points, concept
  tree, insights, memory, diagnostic) and are reused inside the feature pages; new panels are
  drawn for the carousel, the lesson loop, the guide outline, the postmortem form and trail,
  quiz setup, distractors, the review card, and each of the four games.
- **`src/components/marketing/FeaturePage.tsx`** — server component. Hero (h1 = claim, lede
  = body, benefits, CTA pair, hero mock on `bg-accent`), zig-zag sections alternating mock
  side, "Also on synapseHQ" strip of the other six, closing CTA. CTA pair follows `Landing`:
  sign-up only when `isSignupOpen()`, sign-in always, `/browse` always.
- **`src/app/(app)/features/[slug]/page.tsx`** — `generateStaticParams` over the slugs,
  `notFound()` otherwise, `generateMetadata` from claim/body. **`/features`** lists all seven.
  Both are inside the `(app)` group so a signed-out visitor gets the same shell as the landing.
- **`FeatureShowcase`** derives its tabs from the registry: label, icon, claim, body, hero
  mock, a `Coming` badge on the tab when `status = coming`, and a "Learn more →" link to the
  page. `SHOWCASE_TABS` keeps its name and now lists the seven slugs.
- `features` joins `RESERVED_HANDLES`.

## §2 Rules carried over

- **No data reads.** The landing's source scan (`tests/components/landing.test.tsx`) is
  extended to every marketing file: no Prisma, no server action, no `fetch`.
- **No voice.** The "does not advertise voice" assertion runs over every feature page.
- **WHAT, never HOW.** Public copy names outcomes (graded against the card's key points; a
  wrong option is wrong in a named way; memory moves only on evidence) and never the
  pipeline, the scoring model, vocabularies or model names.
- **Nothing unbuilt is presented as live.** `status: 'coming'` renders a badge on the tab,
  on the page hero, and in the index.

## §3 Tests (`tests/marketing/features.test.tsx`)

Registry: seven slugs in order, unique; three benefits each; 2–4 sections each; every mock
id resolves; `coming` exactly on `learn` and `study-guides`. Rendering: each slug's page
renders `h1` = claim and the benefits; unknown slug calls `notFound`; the coming badge shows
only where declared. Showcase: seven tabs, each with a "Learn more" link to its page. Route
structure: `features/page.tsx` and `features/[slug]/page.tsx` are shelled routes.
