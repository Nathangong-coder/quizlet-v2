# Stage 1 — Flashcards + Import + Activities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully functional flashcard app (Next.js App Router) with set CRUD, comma/semicolon import, full-text search, and a timed matching game — all data persisted in Postgres via Prisma, protected behind GitHub OAuth via Auth.js.

**Architecture:** Next.js 15 App Router with server actions for all mutations; Prisma talking to a Postgres database (Neon or Supabase); Auth.js v5 using a database session strategy with PrismaAdapter; pure-function game and parser logic that is independently unit-tested with Vitest.

**Tech Stack:** Next.js 15, React 19, TypeScript 5, Tailwind CSS, shadcn/ui, Auth.js (next-auth@beta), @auth/prisma-adapter, Prisma 5+, PostgreSQL (Neon/Supabase), Zod, Vitest.

## Global Constraints

- All mutations use Next.js server actions (no separate REST routes beyond auth).
- All AI responses and import data validated with Zod before use or persistence.
- `src/` directory layout with `@/` import alias.
- `DATABASE_URL`, `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET` required in `.env`.
- `.env` is gitignored; never commit it. All required vars documented in `.env.example`.
- No `.env` changes — add a `.env.local` for local dev overrides if needed.
- Matching game state designed for future multiplayer: `sessionId` field present from day one.
- Tests live in `tests/` directory, mirroring `src/lib/` structure.

---

## File Map

```
quizlet-v2/
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout: font, Tailwind, nav shell
│   │   ├── page.tsx                      # Redirects to /sets
│   │   ├── globals.css
│   │   ├── sets/
│   │   │   ├── page.tsx                  # List all user's sets
│   │   │   ├── new/
│   │   │   │   └── page.tsx              # Create set (renders SetForm)
│   │   │   └── [id]/
│   │   │       ├── page.tsx              # View set: cards + activity buttons
│   │   │       ├── edit/
│   │   │       │   └── page.tsx          # Edit set (renders SetForm)
│   │   │       └── match/
│   │   │           └── page.tsx          # Matching game page
│   │   └── api/
│   │       └── auth/
│   │           └── [...nextauth]/
│   │               └── route.ts          # Auth.js handler
│   ├── components/
│   │   ├── Navbar.tsx                    # Top nav with sign-in/out
│   │   ├── sets/
│   │   │   ├── SetCard.tsx               # Grid card for a set (title, count, date)
│   │   │   ├── SetForm.tsx               # Create/edit form with card rows
│   │   │   ├── CardRow.tsx               # Single editable term/definition row
│   │   │   └── ImportDialog.tsx          # Paste-import dialog (uses parseImport)
│   │   ├── search/
│   │   │   └── SearchBar.tsx             # Controlled input + results dropdown
│   │   └── game/
│   │       ├── MatchGame.tsx             # Main game board, manages MatchGameState
│   │       ├── MatchTileCard.tsx         # Individual clickable tile
│   │       └── MatchTimer.tsx            # Counts up, displays mm:ss
│   ├── lib/
│   │   ├── db.ts                         # PrismaClient singleton
│   │   ├── parser/
│   │   │   └── import.ts                 # parseImport() pure function
│   │   └── game/
│   │       └── match.ts                  # initMatchGame, selectTile, isComplete
│   ├── actions/
│   │   └── sets.ts                       # createSet, updateSet, deleteSet server actions
│   ├── auth.ts                           # Auth.js config (handlers, auth, signIn, signOut)
│   └── middleware.ts                     # Protect /sets/new, /sets/*/edit, /sets/*/match
├── tests/
│   ├── parser/
│   │   └── import.test.ts
│   └── game/
│       └── match.test.ts
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── types/
│   └── next-auth.d.ts                    # Extend Session to include user.id
├── vitest.config.ts
├── .env.example
└── package.json
```

---

### Task 1: Project Scaffold + Layout Shell

**Files:**
- Create: `package.json` (via create-next-app)
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/components/Navbar.tsx`
- Create: `src/app/page.tsx`

**Interfaces:**
- Produces: Working Next.js dev server at `http://localhost:3000`, vitest runnable

- [ ] **Step 1: Scaffold Next.js project**

Run inside `quizlet-v2/` (answer "No" when asked to init a new git repo):

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-git
```

When prompted: TypeScript=Yes, ESLint=Yes, Tailwind=Yes, App Router=Yes, src/ dir=Yes, `@/*` alias=Yes.

- [ ] **Step 2: Install additional dependencies**

```bash
npm install next-auth@beta @auth/prisma-adapter prisma @prisma/client zod
npm install -D vitest @vitejs/plugin-react @vitest/coverage-v8
```

- [ ] **Step 3: Install and init shadcn/ui**

```bash
npx shadcn@latest init
```

When prompted: style=Default, base color=Slate, CSS variables=Yes.

Then add the components used in this stage:

```bash
npx shadcn@latest add button input textarea dialog card badge separator label
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 5: Add test script to `package.json`**

Open `package.json`. In the `"scripts"` block add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Create `tests/` directory structure**

```bash
mkdir -p tests/parser tests/game
```

- [ ] **Step 7: Create `.env.example`**

```
# Postgres connection string (Neon or Supabase)
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require"

# Auth.js — generate with: openssl rand -base64 32
NEXTAUTH_SECRET=""
NEXTAUTH_URL="http://localhost:3000"

# GitHub OAuth app (https://github.com/settings/developers)
GITHUB_ID=""
GITHUB_SECRET=""
```

- [ ] **Step 8: Write the root layout**

Replace `src/app/layout.tsx` entirely:

```tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/Navbar'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Quizlet v2',
  description: 'Finance interview prep — flashcards, matching, AI grading',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-background text-foreground min-h-screen`}>
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  )
}
```

- [ ] **Step 9: Create placeholder `Navbar.tsx`**

```tsx
// src/components/Navbar.tsx
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function Navbar() {
  return (
    <nav className="border-b bg-background">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/sets" className="font-bold text-lg tracking-tight">
          Quizlet v2
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sets">My Sets</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sets/new">+ New Set</Link>
          </Button>
        </div>
      </div>
    </nav>
  )
}
```

- [ ] **Step 10: Create home page redirect**

```tsx
// src/app/page.tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/sets')
}
```

- [ ] **Step 11: Verify the dev server starts**

```bash
npm run dev
```

Expected: server starts, `http://localhost:3000` redirects to `/sets`, page shows "My Sets" and "+ New Set" in the nav. `/sets` page may 404 (not built yet) — that's fine.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 15 project with shadcn/ui, vitest, layout shell"
```

---

### Task 2: Prisma Schema + Database

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`
- Create: `src/lib/db.ts`

**Interfaces:**
- Produces: `prisma` singleton exported from `@/lib/db`; `Set`, `Card`, `User` Prisma models available

- [ ] **Step 1: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

This creates `prisma/schema.prisma` and adds `DATABASE_URL` to `.env`.

- [ ] **Step 2: Fill in `prisma/schema.prisma`**

Replace the entire file:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  image         String?
  accounts      Account[]
  sessions      Session[]
  sets          Set[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model Set {
  id          String   @id @default(cuid())
  title       String
  description String?
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  cards       Card[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId])
}

model Card {
  id         String   @id @default(cuid())
  term       String
  definition String
  position   Int
  setId      String
  set        Set      @relation(fields: [setId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([setId])
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

- [ ] **Step 3: Set up your database**

Create a free database at https://neon.tech or https://supabase.com. Copy the connection string into `.env` as `DATABASE_URL`.

- [ ] **Step 4: Run first migration**

```bash
npx prisma migrate dev --name init
```

Expected output ends with: `Your database is now in sync with your schema.`

- [ ] **Step 5: Generate client**

```bash
npx prisma generate
```

- [ ] **Step 6: Create PrismaClient singleton at `src/lib/db.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 7: Create `prisma/seed.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      email: 'demo@example.com',
      name: 'Demo User',
      sets: {
        create: {
          title: 'Finance Interview Basics',
          description: 'Core concepts for investment banking and PE interviews',
          cards: {
            create: [
              { term: 'P/E Ratio', definition: 'Price per share divided by earnings per share; measures how much investors pay per $1 of earnings', position: 0 },
              { term: 'EBITDA', definition: 'Earnings Before Interest, Taxes, Depreciation, and Amortization — a proxy for operating cash flow', position: 1 },
              { term: 'DCF', definition: 'Discounted Cash Flow — projects future FCF and discounts them to present value using WACC', position: 2 },
              { term: 'WACC', definition: 'Weighted Average Cost of Capital — blended cost of equity and debt, used as the DCF discount rate', position: 3 },
              { term: 'Enterprise Value', definition: 'Market cap + net debt (debt minus cash); total firm value independent of capital structure', position: 4 },
              { term: 'LBO', definition: 'Leveraged Buyout — acquisition primarily funded with debt, using the target\'s assets and cash flows as collateral', position: 5 },
            ],
          },
        },
      },
    },
  })
  console.log(`Seeded: ${user.email}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
```

- [ ] **Step 8: Add seed script to `package.json`**

In the `"scripts"` block add:

```json
"db:seed": "ts-node --compiler-options '{\"module\":\"CommonJS\"}' prisma/seed.ts",
"db:studio": "prisma studio"
```

And add `ts-node` to dev dependencies:

```bash
npm install -D ts-node
```

- [ ] **Step 9: Run seed**

```bash
npm run db:seed
```

Expected: `Seeded: demo@example.com`

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema (User, Set, Card, Auth.js tables), seed data"
```

---

### Task 3: Auth.js (NextAuth v5) with GitHub OAuth

**Files:**
- Create: `src/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/middleware.ts`
- Create: `types/next-auth.d.ts`
- Modify: `src/components/Navbar.tsx`

**Interfaces:**
- Produces: `auth()` callable from server components/actions; `signIn()`, `signOut()` callable from client; session includes `session.user.id`

- [ ] **Step 1: Create GitHub OAuth App**

Go to https://github.com/settings/developers → New OAuth App.
- Application name: `Quizlet v2 Dev`
- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

Copy the Client ID and Secret into `.env`:

```
GITHUB_ID="your_client_id"
GITHUB_SECRET="your_client_secret"
NEXTAUTH_SECRET="run: openssl rand -base64 32"
```

- [ ] **Step 2: Create `src/auth.ts`**

```typescript
import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import GitHub from 'next-auth/providers/github'
import { prisma } from '@/lib/db'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
    }),
  ],
  session: { strategy: 'database' },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
})
```

- [ ] **Step 3: Create the route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from '@/auth'
export const { GET, POST } = handlers
```

- [ ] **Step 4: Create `types/next-auth.d.ts`**

```typescript
import 'next-auth'
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
    } & DefaultSession['user']
  }
}
```

- [ ] **Step 5: Create `src/middleware.ts`**

```typescript
export { auth as middleware } from '@/auth'

export const config = {
  matcher: ['/sets/new', '/sets/:id*/edit', '/sets/:id*/match'],
}
```

- [ ] **Step 6: Update `Navbar.tsx` to show sign-in/out**

Replace `src/components/Navbar.tsx` entirely:

```tsx
import Link from 'next/link'
import { auth, signIn, signOut } from '@/auth'
import { Button } from '@/components/ui/button'

export default async function Navbar() {
  const session = await auth()

  return (
    <nav className="border-b bg-background">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/sets" className="font-bold text-lg tracking-tight">
          Quizlet v2
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sets">My Sets</Link>
          </Button>
          {session ? (
            <>
              <Button asChild size="sm">
                <Link href="/sets/new">+ New Set</Link>
              </Button>
              <form
                action={async () => {
                  'use server'
                  await signOut({ redirectTo: '/' })
                }}
              >
                <Button variant="outline" size="sm" type="submit">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <form
              action={async () => {
                'use server'
                await signIn('github')
              }}
            >
              <Button size="sm" type="submit">
                Sign in with GitHub
              </Button>
            </form>
          )}
        </div>
      </div>
    </nav>
  )
}
```

- [ ] **Step 7: Verify auth flow**

```bash
npm run dev
```

Expected:
1. `http://localhost:3000` → redirects to `/sets`
2. Navbar shows "Sign in with GitHub"
3. Clicking it → GitHub OAuth flow → returns to `/sets`, navbar shows "Sign out"
4. Visiting `/sets/new` without auth → redirected to sign-in

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: Auth.js v5 with GitHub OAuth, database sessions, session.user.id"
```

---

### Task 4: Import Parser (TDD)

**Files:**
- Create: `tests/parser/import.test.ts`
- Create: `src/lib/parser/import.ts`

**Interfaces:**
- Produces: `parseImport(text: string, options?: ParseOptions): ParsedCard[]`
- Produces: `ParsedCard = { term: string; definition: string }`
- Produces: `ParseOptions = { cardDelimiter?: string; fieldDelimiter?: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/parser/import.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseImport } from '@/lib/parser/import'

describe('parseImport', () => {
  it('parses basic comma/semicolon format', () => {
    const input = 'P/E Ratio,Price per share divided by earnings per share;EBITDA,Earnings before interest taxes depreciation amortization'
    expect(parseImport(input)).toEqual([
      { term: 'P/E Ratio', definition: 'Price per share divided by earnings per share' },
      { term: 'EBITDA', definition: 'Earnings before interest taxes depreciation amortization' },
    ])
  })

  it('trims whitespace around terms and definitions', () => {
    const input = '  term  ,  definition  ;  term2  ,  def2  '
    expect(parseImport(input)).toEqual([
      { term: 'term', definition: 'definition' },
      { term: 'term2', definition: 'def2' },
    ])
  })

  it('handles quoted values containing commas', () => {
    const input = '"Net income, attributable to shareholders",Total profit after tax;ROE,Return on equity'
    expect(parseImport(input)).toEqual([
      { term: 'Net income, attributable to shareholders', definition: 'Total profit after tax' },
      { term: 'ROE', definition: 'Return on equity' },
    ])
  })

  it('handles quoted definitions containing commas', () => {
    const input = 'WACC,"Weighted average of cost of equity, cost of debt, and preferred stock"'
    expect(parseImport(input)).toEqual([
      { term: 'WACC', definition: 'Weighted average of cost of equity, cost of debt, and preferred stock' },
    ])
  })

  it('skips empty entries between semicolons', () => {
    const input = 'term,def;;term2,def2;'
    expect(parseImport(input)).toEqual([
      { term: 'term', definition: 'def' },
      { term: 'term2', definition: 'def2' },
    ])
  })

  it('throws on entry missing a comma separator', () => {
    expect(() => parseImport('term-only')).toThrow()
  })

  it('returns empty array for empty input', () => {
    expect(parseImport('')).toEqual([])
    expect(parseImport('   ')).toEqual([])
  })

  it('accepts custom delimiters', () => {
    const input = 'term\tdefinition\nterm2\tdef2'
    expect(parseImport(input, { cardDelimiter: '\n', fieldDelimiter: '\t' })).toEqual([
      { term: 'term', definition: 'definition' },
      { term: 'term2', definition: 'def2' },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/parser/import.test.ts
```

Expected: `FAIL` — "Cannot find module '@/lib/parser/import'"

- [ ] **Step 3: Create `src/lib/parser/import.ts`**

```typescript
import { z } from 'zod'

const ParsedCardSchema = z.object({
  term: z.string().min(1, 'Term cannot be empty'),
  definition: z.string().min(1, 'Definition cannot be empty'),
})

export type ParsedCard = z.infer<typeof ParsedCardSchema>

export interface ParseOptions {
  cardDelimiter?: string
  fieldDelimiter?: string
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current.trim())
  return fields
}

export function parseImport(text: string, options: ParseOptions = {}): ParsedCard[] {
  const { cardDelimiter = ';', fieldDelimiter = ',' } = options

  const trimmed = text.trim()
  if (!trimmed) return []

  return trimmed
    .split(cardDelimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const fields = parseCsvLine(entry, fieldDelimiter)
      if (fields.length < 2) {
        throw new Error(
          `Card ${index + 1}: expected "term${fieldDelimiter}definition", got "${entry}"`
        )
      }
      return ParsedCardSchema.parse({
        term: fields[0],
        definition: fields.slice(1).join(fieldDelimiter).trim(),
      })
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/parser/import.test.ts
```

Expected: all 8 tests `PASS`

- [ ] **Step 5: Commit**

```bash
git add tests/parser/import.test.ts src/lib/parser/import.ts
git commit -m "feat: import parser with comma/semicolon format, quote handling, Zod validation"
```

---

### Task 5: Set CRUD Server Actions

**Files:**
- Create: `src/actions/sets.ts`

**Interfaces:**
- Produces: `createSet(input: SetInput): Promise<ActionResult<{id: string}>>`
- Produces: `updateSet(id: string, input: SetInput): Promise<ActionResult>`
- Produces: `deleteSet(id: string): Promise<ActionResult>`
- Produces: `SetInput = { title: string; description?: string; cards: CardInput[] }`
- Produces: `CardInput = { term: string; definition: string; position: number }`
- Produces: `ActionResult<T> = { success: true; data: T } | { success: false; error: string }`

- [ ] **Step 1: Create `src/actions/sets.ts`**

```typescript
'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const CardInputSchema = z.object({
  term: z.string().min(1, 'Term is required'),
  definition: z.string().min(1, 'Definition is required'),
  position: z.number().int().min(0),
})

const SetInputSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(1000).optional(),
  cards: z.array(CardInputSchema).min(1, 'At least one card is required'),
})

export type CardInput = z.infer<typeof CardInputSchema>
export type SetInput = z.infer<typeof SetInputSchema>
export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string }

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')
  return session.user.id
}

export async function createSet(input: SetInput): Promise<ActionResult<{ id: string }>> {
  try {
    const userId = await requireUser()
    const parsed = SetInputSchema.parse(input)

    const set = await prisma.set.create({
      data: {
        title: parsed.title,
        description: parsed.description,
        userId,
        cards: {
          create: parsed.cards.map((c) => ({
            term: c.term,
            definition: c.definition,
            position: c.position,
          })),
        },
      },
    })

    revalidatePath('/sets')
    return { success: true, data: { id: set.id } }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

export async function updateSet(id: string, input: SetInput): Promise<ActionResult> {
  try {
    const userId = await requireUser()

    const existing = await prisma.set.findUnique({ where: { id } })
    if (!existing || existing.userId !== userId) {
      return { success: false, error: 'Not found or not authorized' }
    }

    const parsed = SetInputSchema.parse(input)

    await prisma.$transaction([
      prisma.card.deleteMany({ where: { setId: id } }),
      prisma.set.update({
        where: { id },
        data: {
          title: parsed.title,
          description: parsed.description,
          cards: {
            create: parsed.cards.map((c) => ({
              term: c.term,
              definition: c.definition,
              position: c.position,
            })),
          },
        },
      }),
    ])

    revalidatePath(`/sets/${id}`)
    revalidatePath('/sets')
    return { success: true, data: undefined }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

export async function deleteSet(id: string): Promise<never> {
  const session = await auth()
  if (!session?.user?.id) redirect('/')

  const existing = await prisma.set.findUnique({ where: { id } })
  if (!existing || existing.userId !== session.user.id) redirect('/sets')

  await prisma.set.delete({ where: { id } })
  revalidatePath('/sets')
  redirect('/sets')
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/actions/sets.ts
git commit -m "feat: server actions for set CRUD (create, update, delete) with Zod validation"
```

---

### Task 6: Sets List Page + Set View Page

**Files:**
- Create: `src/app/sets/page.tsx`
- Create: `src/components/sets/SetCard.tsx`
- Create: `src/app/sets/[id]/page.tsx`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `auth()` from `@/auth`
- Produces: `/sets` page renders user's sets in a grid; `/sets/[id]` renders cards and activity buttons

- [ ] **Step 1: Create `src/components/sets/SetCard.tsx`**

```tsx
import Link from 'next/link'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface SetCardProps {
  id: string
  title: string
  description: string | null
  cardCount: number
  createdAt: Date
}

export default function SetCard({ id, title, description, cardCount, createdAt }: SetCardProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        <CardTitle className="text-base font-semibold line-clamp-2">
          <Link href={`/sets/${id}`} className="hover:underline">
            {title}
          </Link>
        </CardTitle>
        {description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
        )}
      </CardHeader>
      <CardContent>
        <Badge variant="secondary">{cardCount} cards</Badge>
      </CardContent>
      <CardFooter className="flex justify-between items-center text-xs text-muted-foreground">
        <span>{createdAt.toLocaleDateString()}</span>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/sets/${id}`}>Study →</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
```

- [ ] **Step 2: Create `src/app/sets/page.tsx`**

```tsx
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SetCard from '@/components/sets/SetCard'
import { Button } from '@/components/ui/button'

export default async function SetsPage() {
  const session = await auth()

  if (!session?.user?.id) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <h1 className="text-2xl font-bold">Sign in to see your sets</h1>
        <p className="text-muted-foreground">Create flashcard sets, study, and track your progress.</p>
      </div>
    )
  }

  const sets = await prisma.set.findMany({
    where: { userId: session.user.id },
    include: { _count: { select: { cards: true } } },
    orderBy: { updatedAt: 'desc' },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Sets</h1>
        <Button asChild>
          <Link href="/sets/new">+ New Set</Link>
        </Button>
      </div>
      {sets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="mb-4">No sets yet.</p>
          <Button asChild>
            <Link href="/sets/new">Create your first set</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sets.map((s) => (
            <SetCard
              key={s.id}
              id={s.id}
              title={s.title}
              description={s.description}
              cardCount={s._count.cards}
              createdAt={s.createdAt}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `src/app/sets/[id]/page.tsx`**

```tsx
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { deleteSet } from '@/actions/sets'

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()

  const set = await prisma.set.findUnique({
    where: { id },
    include: { cards: { orderBy: { position: 'asc' } } },
  })

  if (!set) notFound()

  const isOwner = session?.user?.id === set.userId

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-3xl font-bold">{set.title}</h1>
          {set.description && (
            <p className="text-muted-foreground mt-1">{set.description}</p>
          )}
        </div>
        {isOwner && (
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/sets/${id}/edit`}>Edit</Link>
            </Button>
            <form action={deleteSet.bind(null, id)}>
              <Button variant="destructive" size="sm" type="submit">Delete</Button>
            </form>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-6">{set.cards.length} cards</p>

      <div className="flex gap-3 mb-8">
        <Button asChild>
          <Link href={`/sets/${id}/match`}>Matching Game</Link>
        </Button>
      </div>

      <Separator className="mb-6" />

      <div className="space-y-3">
        {set.cards.map((card) => (
          <Card key={card.id}>
            <CardContent className="pt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Term</p>
                <p className="font-medium">{card.term}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Definition</p>
                <p>{card.definition}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify pages render**

```bash
npm run dev
```

Navigate to `http://localhost:3000/sets`. After signing in, the page shows "No sets yet." and a "Create your first set" button.

- [ ] **Step 5: Commit**

```bash
git add src/app/sets/ src/components/sets/SetCard.tsx
git commit -m "feat: sets list page and set detail page with cards and activity buttons"
```

---

### Task 7: Set Form + Import UI (Create/Edit)

**Files:**
- Create: `src/components/sets/CardRow.tsx`
- Create: `src/components/sets/ImportDialog.tsx`
- Create: `src/components/sets/SetForm.tsx`
- Create: `src/app/sets/new/page.tsx`
- Create: `src/app/sets/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `createSet`, `updateSet` from `@/actions/sets`; `parseImport` from `@/lib/parser/import`
- Produces: `/sets/new` renders `SetForm` for creation; `/sets/[id]/edit` renders `SetForm` pre-filled

- [ ] **Step 1: Create `src/components/sets/CardRow.tsx`**

```tsx
'use client'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface CardRowProps {
  index: number
  term: string
  definition: string
  onChange: (index: number, field: 'term' | 'definition', value: string) => void
  onRemove: (index: number) => void
  canRemove: boolean
}

export default function CardRow({ index, term, definition, onChange, onRemove, canRemove }: CardRowProps) {
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-start">
      <div>
        {index === 0 && (
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Term</p>
        )}
        <Input
          value={term}
          onChange={(e) => onChange(index, 'term', e.target.value)}
          placeholder="Term"
          required
        />
      </div>
      <div>
        {index === 0 && (
          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Definition</p>
        )}
        <Input
          value={definition}
          onChange={(e) => onChange(index, 'definition', e.target.value)}
          placeholder="Definition"
          required
        />
      </div>
      <div className={index === 0 ? 'mt-5' : ''}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemove(index)}
          disabled={!canRemove}
          className="text-muted-foreground hover:text-destructive"
        >
          ×
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/sets/ImportDialog.tsx`**

```tsx
'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { parseImport, ParsedCard } from '@/lib/parser/import'

interface ImportDialogProps {
  onImport: (cards: ParsedCard[]) => void
}

export default function ImportDialog({ onImport }: ImportDialogProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  function handleImport() {
    setError('')
    try {
      const cards = parseImport(text)
      if (cards.length === 0) {
        setError('No cards found. Use: term,definition;term2,definition2')
        return
      }
      onImport(cards)
      setText('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse error')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import cards</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Format: <code className="bg-muted px-1 rounded">term,definition</code> — separate cards with{' '}
            <code className="bg-muted px-1 rounded">;</code>. Wrap commas in values with quotes.
          </p>
          <Textarea
            className="font-mono text-sm h-40"
            placeholder={'P/E Ratio,Price per share divided by earnings;EBITDA,"Earnings before interest, taxes, depreciation, amortization"'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleImport}>
            Import cards
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Create `src/components/sets/SetForm.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import CardRow from './CardRow'
import ImportDialog from './ImportDialog'
import { createSet, updateSet, SetInput } from '@/actions/sets'
import { ParsedCard } from '@/lib/parser/import'

interface CardDraft {
  term: string
  definition: string
}

interface SetFormProps {
  mode: 'create' | 'edit'
  setId?: string
  initialTitle?: string
  initialDescription?: string
  initialCards?: CardDraft[]
}

const EMPTY_CARD: CardDraft = { term: '', definition: '' }

export default function SetForm({
  mode,
  setId,
  initialTitle = '',
  initialDescription = '',
  initialCards = [EMPTY_CARD, EMPTY_CARD],
}: SetFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [cards, setCards] = useState<CardDraft[]>(initialCards)
  const [error, setError] = useState('')

  function updateCard(index: number, field: 'term' | 'definition', value: string) {
    setCards((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)))
  }

  function removeCard(index: number) {
    setCards((prev) => prev.filter((_, i) => i !== index))
  }

  function addCard() {
    setCards((prev) => [...prev, EMPTY_CARD])
  }

  function handleImport(parsed: ParsedCard[]) {
    setCards((prev) => [
      ...prev.filter((c) => c.term || c.definition),
      ...parsed,
    ])
  }

  function buildInput(): SetInput {
    return {
      title,
      description: description || undefined,
      cards: cards
        .filter((c) => c.term || c.definition)
        .map((c, i) => ({ term: c.term, definition: c.definition, position: i })),
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    startTransition(async () => {
      const input = buildInput()
      const result =
        mode === 'create'
          ? await createSet(input)
          : await updateSet(setId!, input)

      if (!result.success) {
        setError(result.error)
        return
      }

      if (mode === 'create' && result.success) {
        router.push(`/sets/${result.data.id}`)
      } else {
        router.push(`/sets/${setId}`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      <div className="space-y-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Set title (e.g. Finance Interview Basics)"
          className="text-lg font-medium"
          required
        />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
        />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Cards</h2>
        <ImportDialog onImport={handleImport} />
      </div>

      <Separator />

      <div className="space-y-4">
        {cards.map((card, i) => (
          <CardRow
            key={i}
            index={i}
            term={card.term}
            definition={card.definition}
            onChange={updateCard}
            onRemove={removeCard}
            canRemove={cards.length > 1}
          />
        ))}
      </div>

      <Button type="button" variant="outline" onClick={addCard} className="w-full">
        + Add card
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3 justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : mode === 'create' ? 'Create set' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Create `src/app/sets/new/page.tsx`**

```tsx
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import SetForm from '@/components/sets/SetForm'

export default async function NewSetPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/api/auth/signin')

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">New Set</h1>
      <SetForm mode="create" />
    </div>
  )
}
```

- [ ] **Step 5: Create `src/app/sets/[id]/edit/page.tsx`**

```tsx
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import SetForm from '@/components/sets/SetForm'

export default async function EditSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect('/api/auth/signin')

  const set = await prisma.set.findUnique({
    where: { id },
    include: { cards: { orderBy: { position: 'asc' } } },
  })

  if (!set || set.userId !== session.user.id) notFound()

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Edit Set</h1>
      <SetForm
        mode="edit"
        setId={id}
        initialTitle={set.title}
        initialDescription={set.description ?? ''}
        initialCards={set.cards.map((c) => ({ term: c.term, definition: c.definition }))}
      />
    </div>
  )
}
```

- [ ] **Step 6: Test the full create flow**

```bash
npm run dev
```

1. Sign in, click "+ New Set"
2. Enter a title, add 3+ cards manually
3. Click "Create set" → redirected to the set detail page showing your cards
4. Click "Edit" → form pre-filled, edit and save works
5. Click "Import" in the form → paste `P/E Ratio,Price per share;DCF,Discounted cash flow` → click "Import cards" → cards appear in the editor

- [ ] **Step 7: Commit**

```bash
git add src/components/sets/ src/app/sets/new/ src/app/sets/[id]/edit/
git commit -m "feat: set create/edit form with card editor and paste-import dialog"
```

---

### Task 8: Search

**Files:**
- Create: `src/components/search/SearchBar.tsx`
- Modify: `src/app/sets/page.tsx`

**Interfaces:**
- Consumes: `prisma` for searching; query param `?q=` on `/sets` page

- [ ] **Step 1: Create `src/components/search/SearchBar.tsx`**

```tsx
'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { useTransition } from 'react'

export default function SearchBar({ defaultValue = '' }: { defaultValue?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    const params = new URLSearchParams(searchParams.toString())
    if (q) {
      params.set('q', q)
    } else {
      params.delete('q')
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`)
    })
  }

  return (
    <Input
      type="search"
      placeholder="Search sets and cards…"
      defaultValue={defaultValue}
      onChange={handleChange}
      className="max-w-sm"
    />
  )
}
```

- [ ] **Step 2: Update `src/app/sets/page.tsx` to accept query param and filter**

Replace the file:

```tsx
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import SetCard from '@/components/sets/SetCard'
import { Button } from '@/components/ui/button'
import { Suspense } from 'react'
import SearchBar from '@/components/search/SearchBar'

export default async function SetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const session = await auth()

  if (!session?.user?.id) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <h1 className="text-2xl font-bold">Sign in to see your sets</h1>
        <p className="text-muted-foreground">
          Create flashcard sets, study, and track your progress.
        </p>
      </div>
    )
  }

  const sets = await prisma.set.findMany({
    where: {
      userId: session.user.id,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { cards: { some: { OR: [{ term: { contains: q, mode: 'insensitive' } }, { definition: { contains: q, mode: 'insensitive' } }] } } },
            ],
          }
        : {}),
    },
    include: { _count: { select: { cards: true } } },
    orderBy: { updatedAt: 'desc' },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Sets</h1>
        <Button asChild>
          <Link href="/sets/new">+ New Set</Link>
        </Button>
      </div>
      <div className="mb-4">
        <Suspense>
          <SearchBar defaultValue={q ?? ''} />
        </Suspense>
      </div>
      {sets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {q ? (
            <p>No sets match "{q}".</p>
          ) : (
            <>
              <p className="mb-4">No sets yet.</p>
              <Button asChild>
                <Link href="/sets/new">Create your first set</Link>
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sets.map((s) => (
            <SetCard
              key={s.id}
              id={s.id}
              title={s.title}
              description={s.description}
              cardCount={s._count.cards}
              createdAt={s.createdAt}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Test search**

```bash
npm run dev
```

1. Create two sets with different titles.
2. Type part of a title in the search bar → grid updates immediately to show only matching sets.
3. Type a term from a card → that card's set appears.
4. Clear search → all sets reappear.

- [ ] **Step 4: Commit**

```bash
git add src/components/search/ src/app/sets/page.tsx
git commit -m "feat: full-text search across set titles, descriptions, and card terms/definitions"
```

---

### Task 9: Matching Game Logic (TDD)

**Files:**
- Create: `tests/game/match.test.ts`
- Create: `src/lib/game/match.ts`

**Interfaces:**
- Produces: `initMatchGame(cards: GameCard[], sessionId?: string): MatchGameState`
- Produces: `selectTile(state: MatchGameState, tileId: string): MatchGameState`
- Produces: `isComplete(state: MatchGameState): boolean`
- Produces: `GameCard = { id: string; term: string; definition: string }`
- Produces: `MatchTile = { id: string; cardId: string; content: string; side: 'term' | 'definition' }`
- Produces: `MatchGameState = { sessionId: string; tiles: MatchTile[]; matched: string[]; selectedTileId: string | null; startedAt: number | null; finishedAt: number | null }`

- [ ] **Step 1: Write failing tests**

Create `tests/game/match.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { initMatchGame, selectTile, isComplete } from '@/lib/game/match'

const SAMPLE_CARDS = [
  { id: 'c1', term: 'P/E Ratio', definition: 'Price / Earnings per share' },
  { id: 'c2', term: 'EBITDA', definition: 'Earnings before interest, taxes, depreciation, amortization' },
  { id: 'c3', term: 'ROE', definition: 'Net Income / Shareholders Equity' },
]

describe('initMatchGame', () => {
  it('creates 2 tiles per card', () => {
    const state = initMatchGame(SAMPLE_CARDS)
    expect(state.tiles).toHaveLength(6)
  })

  it('creates one term tile and one definition tile per card', () => {
    const state = initMatchGame(SAMPLE_CARDS)
    for (const card of SAMPLE_CARDS) {
      const term = state.tiles.find((t) => t.cardId === card.id && t.side === 'term')
      const def = state.tiles.find((t) => t.cardId === card.id && t.side === 'definition')
      expect(term).toBeDefined()
      expect(def).toBeDefined()
      expect(term!.content).toBe(card.term)
      expect(def!.content).toBe(card.definition)
    }
  })

  it('starts with no matched pairs and no selection', () => {
    const state = initMatchGame(SAMPLE_CARDS)
    expect(state.matched).toHaveLength(0)
    expect(state.selectedTileId).toBeNull()
    expect(state.finishedAt).toBeNull()
    expect(state.startedAt).toBeNull()
  })

  it('uses provided sessionId', () => {
    const state = initMatchGame(SAMPLE_CARDS, 'test-session')
    expect(state.sessionId).toBe('test-session')
  })
})

describe('selectTile', () => {
  it('sets selectedTileId on first selection', () => {
    const state = initMatchGame(SAMPLE_CARDS)
    const next = selectTile(state, state.tiles[0].id)
    expect(next.selectedTileId).toBe(state.tiles[0].id)
  })

  it('sets startedAt on first selection', () => {
    const state = initMatchGame(SAMPLE_CARDS)
    const before = Date.now()
    const next = selectTile(state, state.tiles[0].id)
    expect(next.startedAt).toBeGreaterThanOrEqual(before)
  })

  it('does not change startedAt after first selection', () => {
    let state = initMatchGame(SAMPLE_CARDS)
    state = selectTile(state, state.tiles[0].id)
    const firstStartedAt = state.startedAt
    state = selectTile(state, state.tiles[1].id)
    expect(state.startedAt).toBe(firstStartedAt)
  })

  it('matches a pair when term then definition of same card selected', () => {
    let state = initMatchGame(SAMPLE_CARDS)
    const term = state.tiles.find((t) => t.cardId === 'c1' && t.side === 'term')!
    const def = state.tiles.find((t) => t.cardId === 'c1' && t.side === 'definition')!
    state = selectTile(state, term.id)
    state = selectTile(state, def.id)
    expect(state.matched).toContain('c1')
    expect(state.selectedTileId).toBeNull()
  })

  it('matches a pair when definition then term of same card selected', () => {
    let state = initMatchGame(SAMPLE_CARDS)
    const term = state.tiles.find((t) => t.cardId === 'c1' && t.side === 'term')!
    const def = state.tiles.find((t) => t.cardId === 'c1' && t.side === 'definition')!
    state = selectTile(state, def.id)
    state = selectTile(state, term.id)
    expect(state.matched).toContain('c1')
  })

  it('does not match when two tiles of different cards selected', () => {
    let state = initMatchGame(SAMPLE_CARDS)
    const tile1 = state.tiles.find((t) => t.cardId === 'c1' && t.side === 'term')!
    const tile2 = state.tiles.find((t) => t.cardId === 'c2' && t.side === 'definition')!
    state = selectTile(state, tile1.id)
    state = selectTile(state, tile2.id)
    expect(state.matched).toHaveLength(0)
    expect(state.selectedTileId).toBe(tile2.id)
  })

  it('does not match when same tile selected twice', () => {
    let state = initMatchGame(SAMPLE_CARDS)
    const tile = state.tiles[0]
    state = selectTile(state, tile.id)
    state = selectTile(state, tile.id)
    expect(state.matched).toHaveLength(0)
    expect(state.selectedTileId).toBe(tile.id)
  })

  it('ignores selection on already matched tiles', () => {
    let state = initMatchGame(SAMPLE_CARDS)
    const term = state.tiles.find((t) => t.cardId === 'c1' && t.side === 'term')!
    const def = state.tiles.find((t) => t.cardId === 'c1' && t.side === 'definition')!
    state = selectTile(state, term.id)
    state = selectTile(state, def.id)
    const stateAfterMatch = state
    state = selectTile(state, term.id)
    expect(state).toEqual(stateAfterMatch)
  })

  it('sets finishedAt when all pairs matched', () => {
    let state = initMatchGame(SAMPLE_CARDS)
    for (const card of SAMPLE_CARDS) {
      const term = state.tiles.find((t) => t.cardId === card.id && t.side === 'term')!
      const def = state.tiles.find((t) => t.cardId === card.id && t.side === 'definition')!
      state = selectTile(state, term.id)
      state = selectTile(state, def.id)
    }
    expect(state.finishedAt).not.toBeNull()
  })
})

describe('isComplete', () => {
  it('returns false for a new game', () => {
    expect(isComplete(initMatchGame(SAMPLE_CARDS))).toBe(false)
  })

  it('returns true only when all pairs matched', () => {
    let state = initMatchGame(SAMPLE_CARDS)
    for (const card of SAMPLE_CARDS) {
      expect(isComplete(state)).toBe(false)
      const term = state.tiles.find((t) => t.cardId === card.id && t.side === 'term')!
      const def = state.tiles.find((t) => t.cardId === card.id && t.side === 'definition')!
      state = selectTile(state, term.id)
      state = selectTile(state, def.id)
    }
    expect(isComplete(state)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/game/match.test.ts
```

Expected: `FAIL` — "Cannot find module '@/lib/game/match'"

- [ ] **Step 3: Create `src/lib/game/match.ts`**

```typescript
export interface GameCard {
  id: string
  term: string
  definition: string
}

export interface MatchTile {
  id: string
  cardId: string
  content: string
  side: 'term' | 'definition'
}

export interface MatchGameState {
  sessionId: string
  tiles: MatchTile[]
  matched: string[]
  selectedTileId: string | null
  startedAt: number | null
  finishedAt: number | null
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function initMatchGame(cards: GameCard[], sessionId = crypto.randomUUID()): MatchGameState {
  const tiles: MatchTile[] = []
  for (const card of cards) {
    tiles.push({ id: `${card.id}-term`, cardId: card.id, content: card.term, side: 'term' })
    tiles.push({ id: `${card.id}-def`, cardId: card.id, content: card.definition, side: 'definition' })
  }
  return {
    sessionId,
    tiles: shuffle(tiles),
    matched: [],
    selectedTileId: null,
    startedAt: null,
    finishedAt: null,
  }
}

export function selectTile(state: MatchGameState, tileId: string): MatchGameState {
  const tile = state.tiles.find((t) => t.id === tileId)
  if (!tile || state.matched.includes(tile.cardId)) return state

  const startedAt = state.startedAt ?? Date.now()

  if (!state.selectedTileId) {
    return { ...state, selectedTileId: tileId, startedAt }
  }

  if (state.selectedTileId === tileId) {
    return state
  }

  const prev = state.tiles.find((t) => t.id === state.selectedTileId)!

  if (prev.cardId === tile.cardId && prev.side !== tile.side) {
    const matched = [...state.matched, tile.cardId]
    const finishedAt = matched.length === state.tiles.length / 2 ? Date.now() : null
    return { ...state, matched, selectedTileId: null, startedAt, finishedAt }
  }

  return { ...state, selectedTileId: tileId, startedAt }
}

export function isComplete(state: MatchGameState): boolean {
  return state.tiles.length > 0 && state.matched.length === state.tiles.length / 2
}
```

- [ ] **Step 4: Run tests to verify they all pass**

```bash
npm test -- tests/game/match.test.ts
```

Expected: all tests `PASS`

- [ ] **Step 5: Commit**

```bash
git add tests/game/match.test.ts src/lib/game/match.ts
git commit -m "feat: matching game pure logic (initMatchGame, selectTile, isComplete) with tests"
```

---

### Task 10: Matching Game UI

**Files:**
- Create: `src/components/game/MatchTimer.tsx`
- Create: `src/components/game/MatchTileCard.tsx`
- Create: `src/components/game/MatchGame.tsx`
- Create: `src/app/sets/[id]/match/page.tsx`

**Interfaces:**
- Consumes: `initMatchGame`, `selectTile`, `isComplete`, `MatchGameState` from `@/lib/game/match`
- Consumes: set + cards data from `prisma` in the page server component

- [ ] **Step 1: Create `src/components/game/MatchTimer.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'

interface MatchTimerProps {
  startedAt: number | null
  finishedAt: number | null
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function MatchTimer({ startedAt, finishedAt }: MatchTimerProps) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (finishedAt) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [finishedAt])

  if (!startedAt) return <span className="font-mono text-muted-foreground">0:00</span>

  const elapsed = (finishedAt ?? now) - startedAt
  return <span className="font-mono">{formatMs(elapsed)}</span>
}
```

- [ ] **Step 2: Create `src/components/game/MatchTileCard.tsx`**

```tsx
'use client'

interface MatchTileCardProps {
  id: string
  content: string
  isSelected: boolean
  isMatched: boolean
  onClick: (id: string) => void
}

export default function MatchTileCard({ id, content, isSelected, isMatched, onClick }: MatchTileCardProps) {
  return (
    <button
      type="button"
      onClick={() => !isMatched && onClick(id)}
      className={[
        'rounded-lg border-2 p-4 text-sm text-left transition-all duration-150 w-full min-h-[72px] flex items-center',
        isMatched
          ? 'border-green-500 bg-green-50 text-green-800 cursor-default opacity-60'
          : isSelected
          ? 'border-primary bg-primary/10 text-primary shadow-md'
          : 'border-border bg-card hover:border-primary/50 hover:shadow-sm cursor-pointer',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {content}
    </button>
  )
}
```

- [ ] **Step 3: Create `src/components/game/MatchGame.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { MatchGameState, selectTile, isComplete, initMatchGame, GameCard } from '@/lib/game/match'
import MatchTileCard from './MatchTileCard'
import MatchTimer from './MatchTimer'
import { Button } from '@/components/ui/button'

interface MatchGameProps {
  cards: GameCard[]
}

export default function MatchGame({ cards }: MatchGameProps) {
  const [state, setState] = useState<MatchGameState>(() => initMatchGame(cards))

  function handleTileClick(tileId: string) {
    setState((prev) => selectTile(prev, tileId))
  }

  function handleRestart() {
    setState(initMatchGame(cards))
  }

  const done = isComplete(state)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {state.matched.length}/{cards.length} matched
        </div>
        <MatchTimer startedAt={state.startedAt} finishedAt={state.finishedAt} />
      </div>

      {done ? (
        <div className="text-center py-16 space-y-4">
          <p className="text-4xl">🎉</p>
          <h2 className="text-2xl font-bold">Matched!</h2>
          <p className="text-muted-foreground">
            Time:{' '}
            {state.startedAt && state.finishedAt
              ? `${((state.finishedAt - state.startedAt) / 1000).toFixed(1)}s`
              : '—'}
          </p>
          <Button onClick={handleRestart}>Play again</Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {state.tiles.map((tile) => (
            <MatchTileCard
              key={tile.id}
              id={tile.id}
              content={tile.content}
              isSelected={state.selectedTileId === tile.id}
              isMatched={state.matched.includes(tile.cardId)}
              onClick={handleTileClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create `src/app/sets/[id]/match/page.tsx`**

```tsx
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import MatchGame from '@/components/game/MatchGame'

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const set = await prisma.set.findUnique({
    where: { id },
    include: { cards: { orderBy: { position: 'asc' } } },
  })

  if (!set) notFound()

  if (set.cards.length < 2) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground mb-4">
          Need at least 2 cards to play the matching game.
        </p>
        <Button asChild>
          <Link href={`/sets/${id}/edit`}>Add more cards</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link href={`/sets/${id}`}>← Back to {set.title}</Link>
          </Button>
          <h1 className="text-2xl font-bold">Matching Game</h1>
        </div>
      </div>
      <MatchGame cards={set.cards} />
    </div>
  )
}
```

- [ ] **Step 5: Test the matching game**

```bash
npm run dev
```

1. Navigate to a set with at least 4 cards.
2. Click "Matching Game" → tiles displayed in a grid (shuffled).
3. Click a term tile → it highlights.
4. Click its matching definition tile → both turn green.
5. Click a term and a wrong definition → wrong tile becomes selected (replaces old selection), no green.
6. Match all pairs → victory screen shows elapsed time.
7. "Play again" → board reshuffles.

- [ ] **Step 6: Commit**

```bash
git add src/components/game/ src/app/sets/[id]/match/
git commit -m "feat: timed matching game UI (tiles, timer, victory screen, restart)"
```

---

### Task 11: Run All Tests + Final Verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests in `tests/parser/import.test.ts` and `tests/game/match.test.ts` pass.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: build completes without errors. Note any warnings and address them.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

Walk through:
1. Sign in with GitHub.
2. Create a set with 4+ cards manually.
3. Create another set via Import (paste the format).
4. Search for a card term → correct set appears.
5. Open a set → click "Matching Game" → complete the game.
6. Edit a set → change a card definition → save → verify change on detail page.
7. Delete a set → confirm it's gone from the list.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: Stage 1 complete — flashcards, import, search, matching game"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Flashcard data model (sets → cards with term/definition) — Task 2
- [x] Import format: comma-separated, semicolon-delimited — Task 4
- [x] Import parser tolerant of whitespace and quoted commas — Task 4
- [x] In-app set builder (create/edit cards directly) — Task 7
- [x] Search across questions/cards — Task 8
- [x] Polished, responsive UI — Tasks 6, 7, 10 (Tailwind + shadcn)
- [x] Timed matching game (single-player; state designed for multiplayer with `sessionId`) — Tasks 9, 10
- [x] Multiplayer-ready game state (`sessionId` field present) — Task 9

**Placeholder scan:** No TODOs or TBDs. All code steps show full implementations.

**Type consistency:**
- `GameCard` defined in Task 9, consumed unchanged in Task 10
- `MatchGameState`, `MatchTile` defined in Task 9, consumed in Task 10
- `SetInput`, `ActionResult` defined in Task 5, consumed in Task 7
- `ParsedCard`, `ParseOptions` defined in Task 4, consumed in Task 7
