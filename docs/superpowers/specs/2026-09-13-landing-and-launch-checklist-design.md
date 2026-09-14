# Landing redesign & launch checklist — design and record

**Date:** 2026-09-13 · **Status:** built on `study-platform`
**Builds on:** `2026-09-13-feature-pages-design.md` (the feature pages the landing now points at)

## §1 The landing

Simple and powerful, in Quizlet's shape and our substance:

- **Signed-out chrome** (`MarketingHeader` + `SiteFooter`, chosen in `(app)/layout.tsx` when
  there is no session) replaces the app rail for visitors: logo · **Study tools ▾** (the seven
  features + Study groups) · **Subjects ▾** (the nine subject groups → filtered Browse) · a
  search box that lands on `/browse?q=` · **Create** (→ sign-up, or sign-in when sign-up is
  closed) · **Log in**. Menus are disclosure buttons (aria-expanded, Escape / outside click);
  on small screens they fold into a drawer. Signed-in users keep the rail; the footer renders
  under both.
- **Landing** (`Landing.tsx`, no data reads): "How do you want to study?" + one line +
  **one CTA** ("Sign up for free" / "Sign in") + a text link to Browse; four tool cards
  (Flashcards, Test, Study guides, Games) on light slabs with explicit dark text (the base
  stylesheet paints every `h2` in `--foreground`, which Lighthouse caught as a dark-mode
  contrast failure); two zig-zag stories; a closing block repeating the same CTA.
- **Footer** from `FOOTER_COLUMNS` (`src/lib/marketing/nav.ts`): About · For learners ·
  Account · Legal, "English" as a fact (no fake selector), cookie choices, ©. The `/signup`
  link and the sitemap entry are gated on `isSignupOpen()` — `/signup` 404s while closed.
- `FeatureShowcase` is deleted; the feature pages carry that content.

## §2 The checklist, item by item

| # | Item | Done as |
|---|---|---|
| 1 | Privacy policy | `/privacy` — written against what the app actually does (schema, AI layer, Blob, Resend, Vercel Analytics). **Placeholders:** `[legal entity name]`, `[privacy contact email]`. |
| 2 | Terms | `/terms` — content licence, public-set copies, AI-on-your-keys, groups, acceptable use. **Placeholders:** `[legal entity name]`, `[contact email]`, `[jurisdiction]`. |
| 3 | Cookie banner | `CookieBanner` in the root layout: one essential cookie stated, analytics **opt-in** ("Allow analytics" / "Essential only"), remembered in `localStorage` (`synapsehq:consent`, versioned), changeable from the footer and `/cookies`. Renders nothing until the browser has read storage — no flash, no hydration mismatch. |
| 4 | Secrets off the frontend | Audited: no `NEXT_PUBLIC_` variables, no `process.env` in any `'use client'` module. **Guarded** by `tests/security/client-bundle.test.ts` (scans every client module for env reads and server-only imports; checks `.env` is ignored and `.env.example` holds placeholders). |
| 5 | Force HTTPS | Vercel redirects http→https at the edge; the app adds **HSTS** (1 year, subdomains) + nosniff, SAMEORIGIN, Referrer-Policy, Permissions-Policy in `next.config.ts` (`SECURITY_HEADERS`, tested). No CSP yet — needs nonces; its own change. Microphone deliberately not denied (Stage 4). |
| 6 | Form validation | Server: Zod on every action (already). Client: `required` / `type=email` / `minLength={PASSWORD_MIN_LENGTH}` added to sign-up, sign-in and reset inputs; feedback, groups and set forms already had them. |
| 7 | Spam protection | `src/lib/forms/spam.ts`: **honeypot** (a hidden `website` field) + **clock** (≥ 1.5 s after render) on sign-up, forgot-password and feedback; `checkSpam` is pure and tested; a tripped check returns a generic message (forgot returns its fixed success, so no oracle). Turnstile can be layered later. |
| 8 | Meta titles + descriptions | Root `metadata` with a `%s · synapseHQ` template, description, `metadataBase`; per-page metadata on Browse, sign-in/up, forgot, help, groups, library, features, legal; `generateMetadata` on the set page (through `readableSetWhere`; non-public sets get `noindex`). |
| 9 | Social preview image | `src/app/opengraph-image.tsx` (1200×630, generated at build from the mark; no PNG asset) + Twitter `summary_large_image`. |
| 10 | Favicon | `icon.svg` (existing) + `apple-icon.tsx` (180×180, generated). |
| 11 | Sitemap + robots | `sitemap.ts` (static pages, listable public sets, profiles; capped; hourly revalidate) and `robots.ts` (disallows account, settings, study and API routes). |
| 12 | Alt text | Every `<img>` had `alt`; the two generic ones ("card content", "uploaded asset preview") now describe the file or the block text. |
| 13 | Compress images | No raster assets are shipped: the logo is inline SVG, the OG image and touch icon are generated, user uploads stream from Blob. Nothing to compress. |
| 14 | Page load speed | Lighthouse on the **production build**, landing, mobile throttling — **before** the bundle pass: perf 68, TBT 570 ms, 782 KiB first-load JS; **after**: perf **86**, a11y **100**, BP **100**, SEO **100**, TBT 210 ms, CLS 0, 608 KiB first-load JS (185 KiB transferred). The bundle pass (`next experimental-analyze` + `scripts/route-bytes.ts` + `scripts/trace-imports.ts`) found the landing shipping the signed-in rail, profile menu and avatar dialog (Base UI + floating-ui, ~185 KB) it never rendered, and the full feature-copy registry inside the client header. Fixes: the landing and static pages moved to a `(marketing)` route group whose layout never imports the shell; `MarketingHeader` takes its link lists as props; the `(app)` layout imports only the rail; middleware rewrites a visitor's `/` to `/welcome` (address bar unchanged). A server-side `import()` does NOT split client chunks — the group split is what worked. Remaining LCP (3.4 s simulated) is the HTML+CSS critical path under 1.6 Mbps; no web fonts are loaded. |
| 15 | Colour contrast | `scripts/contrast-audit.ts` computes WCAG ratios for 17 token pairs in both themes; **fixed** `--success` (3.7:1 → 4.9:1) and `--input` border (1.4:1 → 3.3:1); gated by `tests/design/contrast.test.ts`. Lighthouse a11y 100 after the tool-card fix. |
| 16 | Mobile friendly | Header folds into a drawer under `md`; landing grids stack; footer 1→2→5 columns; cookie banner is inset on phones. (Verified by breakpoint; the browser window could not be resized in this session.) |
| 17 | Custom 404 | `src/app/not-found.tsx` — explains, offers Home / Browse / Library, reads no data. |
| 18 | Broken links | `scripts/crawl-links.ts` crawled 113 pages signed-out: **0 broken** (the one 500 is `/api/assets/*` with no `BLOB_READ_WRITE_TOKEN` locally). Found and fixed: footer `/signup` while sign-up is closed. |
| 19 | One clear CTA | Landing hero has one button; Browse is a text link; the closing block repeats the same CTA. Tested. |
| 20 | Analytics | `@vercel/analytics` (cookieless), mounted only after "Allow analytics"; lazy-loaded. |

## §3 Found on the way

**The middleware gate failed open when Auth.js errored.** Running `next start` locally without
`AUTH_TRUST_HOST`, Auth.js raised `UntrustedHost` and handed the middleware callback its error
object as `req.auth` — truthy — so `!req.auth` let every anonymous request through every
"protected" route. Pages check the session themselves, so nothing was exposed, but the
middleware now tests `req.auth?.user` and never `req.auth`. `.env.example` documents
`AUTH_TRUST_HOST` for local production runs (Vercel sets the equivalent itself).

## §4 Owner to-do

- Legal placeholders filled 2026-09-13 (synapseHQ · ngong7053@gmail.com · United States); a test
  asserts none remain.
- After deploy: run PageSpeed Insights on the real domain.
- Optional: a CSP with nonces; a real state for the governing-law clause.
