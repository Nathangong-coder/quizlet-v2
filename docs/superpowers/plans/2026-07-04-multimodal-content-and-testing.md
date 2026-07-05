# Multimodal Content & Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the *authoring-only* rich-card scaffolding from Stage 3.5 into a fully usable multimodal experience. Terms and definitions can contain images, audio, video, spreadsheets (Excel/CSV), PDFs, and general files. These render on the flashcard, in Review/Learn mode, and in every quiz mode, and — critically — they are **actually sent to Gemini** for multiple-choice generation and short-answer grading via native multimodal input.

**Current reality (verified in code):**
- Schema already has `CardContentBlock` (`side`, `type` = `text|image|video|file`, `text`, `assetId`, `position`) and `CardAsset` (Vercel Blob, `access: "private"`, `storageKey` = blob URL, `mimeType`, `sizeBytes`).
- `src/actions/uploads.ts` accepts only `image/jpeg|png|webp`, `video/mp4`, `application/pdf`, 10 MB cap.
- `src/components/sets/RichCardSideEditor.tsx` can add blocks but only shows `"image asset (ID: ...)"` — **no preview, no playback, no rendering**.
- `src/lib/cards/content.ts` `contentBlocksToPlainText()` throws away every non-text block.
- `src/lib/ai/google.ts` `generateJsonWithGoogle()` takes a **string prompt only**. All prompt builders in `src/lib/ai/prompts.ts` read `card.term` / `card.definition` text. **No media ever reaches Gemini today.**

So the work is: (1) widen ingestion, (2) build a shared renderer, (3) build a multimodal Gemini path, (4) wire media into quiz/review, (5) add the Excel dual-path (bulk-import + testable artifact).

**Decisions locked with the product owner:**
- **Excel/CSV = both import *and* attach.** On upload, if the sheet looks like `term,definition` rows, offer bulk-import into cards; otherwise attach it to a card side as a testable spreadsheet artifact (rendered as a table + handed to Gemini as data).
- **Grading uses native Gemini multimodal** — send the real image/audio/PDF/sheet bytes as `inlineData` parts, not OCR/transcription-to-text. (Voice *delivery* metrics — filler words, pacing — remain Stage 4; here audio is just another medium, e.g. "listen and identify the concept.")

**Tech stack:** Existing Next.js App Router, Prisma, Auth.js, Zod, Vitest, shadcn/ui, Tailwind, `@google/generative-ai`, `@vercel/blob`. Add `xlsx` (SheetJS) for spreadsheet parsing.

## Global Constraints

- **Backwards compatible.** Text-only cards, the comma/semicolon importer, matching, and print must keep working unchanged. `Card.term`/`Card.definition` stay populated as the plain-text fallback (search, matching tiles, MC distractor text).
- **Ownership + privacy.** Assets are private blobs. Any byte fetch for rendering or AI must go through a server action / route that verifies the signed-in user owns the asset's set. Never embed a raw private blob URL in client HTML.
- **Validate everything with Zod:** MIME type (allowlist), size, per-side block shape, parsed spreadsheet structure.
- **Media → AI is opt-in per call and size-bounded.** Gemini `inlineData` has request-size limits; enforce a per-asset cap (e.g. ≤ 4 MB inline; larger files degrade to a text description / filename only) and a per-request part budget.
- **Graceful degradation.** If an asset fails to load or the user has no Google key, every surface must fall back to text (`contentBlocksToPlainText`) instead of crashing.
- **Cost awareness.** Multimodal calls cost more and can't be cached the way `QuizOptionCache` caches MC text. Reuse cache keyed on card content hash (see Task 6).

---

## File Map

```
quizlet-v2/
├── package.json                                  # ADD: xlsx (SheetJS)
├── prisma/
│   └── schema.prisma                             # MODIFY: CardAsset.kind + textExtract; CardContentBlock.type enum widen
├── src/
│   ├── actions/
│   │   ├── uploads.ts                            # MODIFY: widen allowlist, sniff kind, extract sheet/text preview
│   │   └── import.ts                             # NEW: spreadsheet -> cards bulk import action
│   ├── app/
│   │   └── api/assets/[id]/route.ts              # NEW: authenticated asset byte proxy (private blob -> owner only)
│   ├── components/
│   │   ├── cards/
│   │   │   ├── ContentBlockView.tsx              # NEW: shared renderer (image/audio/video/sheet/file/text)
│   │   │   └── SpreadsheetTable.tsx              # NEW: render parsed sheet rows
│   │   ├── sets/
│   │   │   ├── RichCardSideEditor.tsx            # MODIFY: real previews, playback, sheet import prompt
│   │   │   └── ImportDialog.tsx                  # MODIFY: accept .xlsx/.csv drop -> bulk import
│   │   ├── flashcard/FlashcardCarousel.tsx       # MODIFY: render media on both faces
│   │   ├── review/ReviewSession.tsx              # MODIFY: render media on flip
│   │   └── quiz/*                                # MODIFY: render media prompts (MC/SA/TF/matching)
│   ├── lib/
│   │   ├── cards/
│   │   │   ├── content.ts                        # MODIFY: block kinds, render model, AI-part extraction
│   │   │   └── spreadsheet.ts                    # NEW: parse xlsx/csv -> rows; detect term/def shape
│   │   ├── ai/
│   │   │   ├── google.ts                         # MODIFY: generateJsonMultimodal(parts[])
│   │   │   ├── media.ts                          # NEW: assetId -> Gemini Part (fetch, size-gate, base64)
│   │   │   ├── prompts.ts                        # MODIFY: multimodal-aware prompt builders
│   │   │   └── schemas.ts                        # (unchanged output schemas)
│   │   └── uploads/index.ts                      # MODIFY: expose kind/mime helpers
├── tests/
│   ├── cards/spreadsheet.test.ts                 # NEW
│   ├── cards/content.test.ts                     # MODIFY: non-text blocks
│   └── ai/media.test.ts                          # NEW: size-gate + fallback logic
```

---

### Task 1: Widen ingestion + spreadsheet parsing

**Files:** `src/actions/uploads.ts`, `src/lib/uploads/index.ts`, `src/lib/cards/spreadsheet.ts`, `tests/cards/spreadsheet.test.ts`, `package.json`, `prisma/schema.prisma`

**Interfaces:**
- Produces: `sniffAssetKind(mime, name): "image"|"audio"|"video"|"spreadsheet"|"pdf"|"file"`
- Produces: `parseSpreadsheet(buffer, mime): { rows: string[][]; sheetName: string }`
- Produces: `looksLikeCardTable(rows): { isTermDef: boolean; termCol: number; defCol: number }`

- [ ] **Step 1: Add `xlsx` and widen the allowlist.** Extend the MIME allowlist in `uploads.ts` to include: `image/gif`, `audio/mpeg|wav|mp4|webm|ogg|x-m4a`, `video/webm|quicktime`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx), `application/vnd.ms-excel`, `text/csv`, plus a small "general file" set (`application/msword`, `.docx`, `text/plain`). Raise the cap thoughtfully per-kind (audio/video may exceed 10 MB — allow up to e.g. 25 MB but flag anything > 4 MB as "not inline-gradable" for Task 5).
- [ ] **Step 2: Sniff a stable `kind`.** Client MIME is untrusted; derive `kind` from MIME + extension. Persist it: add `kind String` and `textExtract String? @db.Text` to `CardAsset` (short extracted preview — first N rows of a sheet as CSV, or a caption stub). Migrate.
- [ ] **Step 3: Spreadsheet parser (pure, tested).** In `lib/cards/spreadsheet.ts`, use SheetJS to read the first sheet to a `string[][]`. `looksLikeCardTable` heuristic: ≥ 2 columns, ≥ 2 rows, first two columns non-empty for most rows; ignore a header row if it reads like `term/word/front` + `definition/meaning/back`.
- [ ] **Step 4: Tests.** Cover: 2-col term/def sheet, single-column sheet (not a card table), sheet with header row, empty sheet, CSV vs XLSX, ragged rows. **Pure functions only — no network.**
- [ ] **Step 5: Store extract on upload.** In `uploadCardAsset`, when `kind === "spreadsheet"`, parse and store `textExtract` (capped CSV preview) so grading/rendering don't re-fetch+parse every time.
- [ ] **Step 6: Commit** — `feat: widen asset ingestion (audio, spreadsheets, general files) + sheet parsing`.

---

### Task 2: Authenticated asset proxy

**Files:** `src/app/api/assets/[id]/route.ts`

**Why:** Blobs are `access: "private"`. Client `<img>`/`<audio>`/`<video>` and the table renderer need bytes, but we must not leak private URLs or serve other users' files.

- [ ] **Step 1: Route `GET /api/assets/[id]`.** Auth the request, load `CardAsset`, verify `asset.set.userId === session.user.id` (owner-only for now; revisit if sets become shareable). Stream the blob through with correct `Content-Type` and `Cache-Control: private`. Support HTTP `Range` for audio/video seeking.
- [ ] **Step 2: Reference by proxy URL everywhere.** All render components (Task 3) point at `/api/assets/{id}`, never at `storageKey`.
- [ ] **Step 3: Manual verify** — logged-out request 401s; a second user 403s; owner streams; audio scrubbing works (Range).
- [ ] **Step 4: Commit** — `feat: authenticated private asset proxy with range support`.

---

### Task 3: Shared content renderer

**Files:** `src/components/cards/ContentBlockView.tsx`, `src/components/cards/SpreadsheetTable.tsx`, `src/lib/cards/content.ts`, `tests/cards/content.test.ts`

**Interfaces:**
- Produces: `<ContentBlockView blocks={...} />` — one component used by carousel, review, and quiz so media renders identically everywhere.
- Produces: `contentBlocksToPlainText(blocks)` **upgraded** to emit descriptive fallbacks for non-text (`"[image: chart.png]"`, `"[spreadsheet: dcf.xlsx]"`) instead of dropping them.

- [ ] **Step 1: Render model.** Map each block kind to a renderer: text → prose; image → `<img>`; audio → `<audio controls>`; video → `<video controls>`; spreadsheet → `<SpreadsheetTable>` (from `textExtract` or lazy parse); pdf → embed/first-page + download; file → download chip. All media via `/api/assets/{id}`.
- [ ] **Step 2: Upgrade `content.ts`.** Widen `ContentBlock.type`/kind, keep `legacyCardToContentBlocks`, and make `contentBlocksToPlainText` include labeled fallbacks (this text is what feeds matching tiles, print, and the AI *when media can't be sent inline*).
- [ ] **Step 3: Fix the editor.** In `RichCardSideEditor.tsx`, replace the `"asset (ID: …)"` stub with `<ContentBlockView>` previews + reorder controls; after uploading a spreadsheet, surface the "This looks like a card list — import as cards instead?" prompt (wired in Task 7).
- [ ] **Step 4: Tests** for `content.ts` block/fallback logic.
- [ ] **Step 5: Commit** — `feat: shared multimodal content renderer + real editor previews`.

---

### Task 4: Multimodal Gemini path

**Files:** `src/lib/ai/google.ts`, `src/lib/ai/media.ts`, `tests/ai/media.test.ts`

**Interfaces:**
- Produces: `generateJsonMultimodal<T>({ apiKey, parts, schema, model })` — same fallback-chain + `stripMarkdownJson` + Zod validation as `generateJsonWithGoogle`, but accepts a `Part[]` (text + `inlineData`).
- Produces: `assetToPart(asset): Promise<Part | null>` — owner-checked fetch, size-gate, base64 `inlineData`; returns `null` (caller falls back to text label) when too large or unsupported.

- [ ] **Step 1: Refactor `google.ts`.** Extract the model-loop/validation core so both the string API and a new `parts` API share it. Keep `generateJsonWithGoogle` as a thin wrapper (`parts = [{ text: prompt }]`) so existing callers are untouched.
- [ ] **Step 2: `media.ts` size-gate.** Fetch bytes server-side, enforce inline cap (≈4 MB) and supported-MIME set for Gemini; over cap → return `null` and let the prompt use the text label. Cap total parts per request.
- [ ] **Step 3: Tests** for the gate + fallback (mock fetch): under-cap image → Part; over-cap → null; unsupported MIME → null.
- [ ] **Step 4: Commit** — `feat: native multimodal Gemini generation with size-gated inline media`.

---

### Task 5: Wire media into quiz + review + grading

**Files:** `src/lib/ai/prompts.ts`, `src/actions/quiz.ts`, quiz components, `src/components/flashcard/FlashcardCarousel.tsx`, `src/components/review/ReviewSession.tsx`

- [ ] **Step 1: Multimodal-aware prompt builders.** Change builders to accept the card's content blocks and return `{ parts, schema }`. E.g. `buildShortAnswerGradeParts(card, blocks, answer)` interleaves the rubric text with `assetToPart(...)` for the prompt side. When a side is an image ("what does this chart show?"), the *media is the question*. Keep text-only cards on the existing fast path.
- [ ] **Step 2: MC generation with media.** When the tested side has media, send it inline so distractors are grounded in the actual image/sheet. Cache key must include the media hash (Task 6) — a card's image changing must bust the cache.
- [ ] **Step 3: Short-answer grading with media.** `submitShortAnswer` builds parts including the prompt-side media; grading rubric unchanged (clarity/conciseness/correctness/overall) but now the model can see what the learner was asked about. **Spreadsheet answers:** pass the sheet (via `textExtract` CSV, or file Part) so "walk me through this DCF" can be graded against the actual model.
- [ ] **Step 4: Render prompts in every mode.** MC/SA/TF/matching prompt areas use `<ContentBlockView>`; matching tiles fall back to `contentBlocksToPlainText` labels when a whole side is media (a tile can show a thumbnail).
- [ ] **Step 5: Carousel + Review render media on flip** via the shared renderer; audio auto-stops on flip/advance.
- [ ] **Step 6: Manual verify** the 3 media archetypes: image-term ("identify this chart"), audio-term ("what concept is described"), spreadsheet-definition ("explain this model"). Confirm text-only cards are byte-for-byte unchanged.
- [ ] **Step 7: Commit** — `feat: send card media to Gemini and render it across quiz/review`.

---

### Task 6: Content-hash caching

**Files:** `prisma/schema.prisma` (or reuse `QuizOptionCache`), `src/lib/cards/content.ts`, `src/actions/quiz.ts`

- [ ] **Step 1:** Compute a `contentHash` per card side (text + asset `storageKey`s + positions). Add it to the MC cache key so `QuizOptionCache` invalidates when media changes (today it keys only `cardId+model`, so edited cards serve stale options).
- [ ] **Step 2:** Optionally memoize `assetToPart` base64 by `storageKey` within a request to avoid double-fetching a side used in both prompt + grading.
- [ ] **Step 3: Commit** — `feat: content-hash-aware AI caching for rich cards`.

---

### Task 7: Excel dual-path (bulk import + artifact)

**Files:** `src/actions/import.ts`, `src/components/sets/ImportDialog.tsx`, `src/components/sets/RichCardSideEditor.tsx`, `src/lib/parser/import.ts`

- [ ] **Step 1: Import action.** `importSpreadsheet(setId, assetId | file)` → `parseSpreadsheet` → `looksLikeCardTable`; if term/def, create `Card` rows (reuse the existing importer's card-creation path so positions/validation match). Report count + skipped rows.
- [ ] **Step 2: ImportDialog accepts .xlsx/.csv** alongside the comma/semicolon text importer; show a preview table + column picker (which column is term vs definition) before committing.
- [ ] **Step 3: Editor "import instead?" branch.** When a spreadsheet is dropped onto a *card side* and `looksLikeCardTable` is true, offer "Import as N cards" vs "Attach as artifact." Attach keeps it as a `CardContentBlock` (renders via `SpreadsheetTable`, grades via Task 5).
- [ ] **Step 4: Manual verify** both branches from one file; verify a non-table sheet (e.g. a filled DCF model) attaches as a gradable artifact.
- [ ] **Step 5: Commit** — `feat: excel/csv bulk import and testable spreadsheet artifacts`.

---

### Task 8: Final verification

- [ ] `npm test`  ·  `npx tsc --noEmit`  ·  `npm run build`
- [ ] Manual smoke: text-only card unchanged → image card graded → audio card graded → spreadsheet imported → spreadsheet attached+graded → private asset denied to non-owner.
- [ ] Commit — `chore: multimodal content & testing complete`.

---

## Self-Review Checklist

- [x] Excel: both bulk-import **and** testable artifact — Tasks 1, 7
- [x] Images / audio / video / PDF / general files uploadable + rendered — Tasks 1–3
- [x] Media renders on flashcard, Review/Learn, and every quiz mode — Tasks 3, 5
- [x] Media actually reaches Gemini (native multimodal) for MC + grading — Tasks 4, 5
- [x] Private-asset ownership enforced on every byte fetch — Task 2
- [x] Text-only cards + legacy import unaffected — Global Constraints, Task 5 fast path
- [x] Cache invalidates when media changes — Task 6

**Dependencies:** Independent of the memory/plans work, but grading changes here should land the compact grade record that the **Persistent Memory** plan consumes (see that plan's Task 2) — coordinate the `QuizAnswer` write shape.
