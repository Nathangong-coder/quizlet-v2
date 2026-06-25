# Stage 2 — Confidence Memory + Flashcard View + Review Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-card confidence tracking (1–10 scale + starred), a flippable flashcard carousel to the set detail page, and a review mode that cycles cards with smart re-queuing based on confidence.

**Architecture:** Two new Prisma models — `CardProgress` (latest confidence + starred per user+card) and `ConfidenceEvent` (full history for Stage 3 AI). The review session is a pure immutable state machine in `src/lib/review/session.ts`, unit-tested before any UI is wired. The flashcard carousel is a client-only component toggled by local React state. All mutations go through server actions.

**Tech Stack:** Same as Stage 1 — Next.js App Router, Prisma, Zod, Vitest, shadcn/ui. No new packages required.

## Global Constraints

- All mutations use Next.js server actions (no separate REST routes).
- `CardProgress` stores the *current* confidence and starred flag; `ConfidenceEvent` records every answer for Stage 3 AI training-plan queries — both rows must be written on every review answer.
- Re-queue rule: "Don't Know" re-queues the card. If the card's confidence was > 5 at the time of the wrong answer, it gets **at most one** extra appearance. Low-confidence cards (≤ 5) cycle until the user marks "Know."
- Confidence clamped 1–10: "Know" increments by 1, "Don't Know" decrements by 1.
- Flashcard carousel visible state is local React state — no `localStorage`.
- `src/` layout with `@/` alias; tests in `tests/` mirroring `src/lib/` structure.

---

## File Map

```
quizlet-v2/
├── prisma/
│   └── schema.prisma                         # MODIFY: add CardProgress + ConfidenceEvent models
├── src/
│   ├── actions/
│   │   └── confidence.ts                     # NEW: starCard, recordReview server actions
│   ├── components/
│   │   ├── flashcard/
│   │   │   ├── FlashcardCarousel.tsx          # NEW: flip-card, prev/next navigation
│   │   │   └── FlashcardSection.tsx           # NEW: show/hide toggle wrapper (client)
│   │   ├── review/
│   │   │   └── ReviewSession.tsx              # NEW: full review mode client component
│   │   └── sets/
│   │       └── StarButton.tsx                 # NEW: optimistic star/unstar button
│   ├── lib/
│   │   └── review/
│   │       └── session.ts                     # NEW: pure review state machine
│   ├── app/
│   │   └── sets/
│   │       └── [id]/
│   │           ├── page.tsx                   # MODIFY: add carousel, stars, confidence, review btn
│   │           └── review/
│   │               └── page.tsx               # NEW: review mode page
│   └── middleware.ts                          # MODIFY: add /sets/:id*/review to matcher
├── tests/
│   └── review/
│       └── session.test.ts                    # NEW: TDD for review session logic
```

---

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `CardProgress` model with `@@unique([userId, cardId])` — safe upsert target
- Produces: `ConfidenceEvent` model — append-only history, indexed for Stage 3 queries

- [ ] **Step 1: Add relations to existing `User` model**

Open `prisma/schema.prisma`. Inside the `model User { ... }` block, add these two lines after the existing `sets` relation:

```prisma
  cardProgress     CardProgress[]
  confidenceEvents ConfidenceEvent[]
```

- [ ] **Step 2: Add relations to existing `Card` model**

Inside `model Card { ... }`, add after the existing `set` relation:

```prisma
  progress         CardProgress[]
  confidenceEvents ConfidenceEvent[]
```

- [ ] **Step 3: Append the two new models at the end of `schema.prisma`**

```prisma
model CardProgress {
  id         String   @id @default(cuid())
  userId     String
  cardId     String
  confidence Int      @default(5)
  starred    Boolean  @default(false)
  updatedAt  DateTime @updatedAt
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  card       Card     @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@unique([userId, cardId])
  @@index([userId])
}

model ConfidenceEvent {
  id         String   @id @default(cuid())
  userId     String
  cardId     String
  confidence Int
  knew       Boolean
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  card       Card     @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@index([userId, cardId])
  @@index([userId, createdAt])
}
```

- [ ] **Step 4: Run migration**

```bash
npx prisma migrate dev --name confidence-memory
```

Expected: `Your database is now in sync with your schema.`

- [ ] **Step 5: Regenerate client**

```bash
npx prisma generate
```

Expected: no errors.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add CardProgress and ConfidenceEvent models for confidence memory"
```

---

### Task 2: Confidence Server Actions

**Files:**
- Create: `src/actions/confidence.ts`

**Interfaces:**
- Produces: `starCard(cardId: string, setId: string, starred: boolean): Promise<void>`
- Produces: `recordReview(cardId: string, knew: boolean): Promise<{ newConfidence: number }>`

- [ ] **Step 1: Create `src/actions/confidence.ts`**

```typescript
'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'

export async function starCard(
  cardId: string,
  setId: string,
  starred: boolean
): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) return

  await prisma.cardProgress.upsert({
    where: { userId_cardId: { userId: session.user.id, cardId } },
    update: { starred },
    create: { userId: session.user.id, cardId, starred, confidence: 5 },
  })

  revalidatePath(`/sets/${setId}`)
}

export async function recordReview(
  cardId: string,
  knew: boolean
): Promise<{ newConfidence: number }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')

  const userId = session.user.id

  const current = await prisma.cardProgress.findUnique({
    where: { userId_cardId: { userId, cardId } },
    select: { confidence: true },
  })

  const oldConfidence = current?.confidence ?? 5
  const newConfidence = knew
    ? Math.min(10, oldConfidence + 1)
    : Math.max(1, oldConfidence - 1)

  await prisma.$transaction([
    prisma.cardProgress.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: { confidence: newConfidence },
      create: { userId, cardId, confidence: newConfidence, starred: false },
    }),
    prisma.confidenceEvent.create({
      data: { userId, cardId, confidence: newConfidence, knew },
    }),
  ])

  return { newConfidence }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/actions/confidence.ts
git commit -m "feat: starCard and recordReview server actions with ConfidenceEvent logging"
```

---

### Task 3: Review Session Logic (TDD)

**Files:**
- Create: `tests/review/session.test.ts`
- Create: `src/lib/review/session.ts`

**Interfaces:**
- Produces: `ReviewCard = { id: string; term: string; definition: string; confidence: number }`
- Produces: `ReviewSession = { queue: ReviewCard[]; requeuedHighConf: string[]; completed: string[] }`
- Produces: `initReviewSession(cards: ReviewCard[]): ReviewSession`
- Produces: `currentCard(session: ReviewSession): ReviewCard | null`
- Produces: `answerCard(session: ReviewSession, cardId: string, knew: boolean): ReviewSession`
- Produces: `isReviewComplete(session: ReviewSession): boolean`
- Produces: `progressStats(session: ReviewSession): { total: number; completed: number; remaining: number }`

- [ ] **Step 1: Create the tests directory**

```bash
mkdir -p tests/review
```

- [ ] **Step 2: Write failing tests — `tests/review/session.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import {
  initReviewSession,
  currentCard,
  answerCard,
  isReviewComplete,
  progressStats,
} from '@/lib/review/session'
import type { ReviewCard } from '@/lib/review/session'

const CARDS: ReviewCard[] = [
  { id: 'c1', term: 'P/E Ratio', definition: 'Price / EPS', confidence: 5 },
  { id: 'c2', term: 'EBITDA', definition: 'Earnings before interest...', confidence: 7 },
  { id: 'c3', term: 'DCF', definition: 'Discounted cash flow', confidence: 3 },
]

describe('initReviewSession', () => {
  it('puts all cards in queue', () => {
    const s = initReviewSession(CARDS)
    expect(s.queue).toHaveLength(3)
    expect(s.completed).toHaveLength(0)
    expect(s.requeuedHighConf).toHaveLength(0)
  })
})

describe('currentCard', () => {
  it('returns first card in queue', () => {
    const s = initReviewSession(CARDS)
    expect(currentCard(s)).toEqual(CARDS[0])
  })

  it('returns null when queue is empty', () => {
    expect(currentCard(initReviewSession([]))).toBeNull()
  })
})

describe('answerCard — knew: true', () => {
  it('removes card from queue and adds to completed', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c1', true)
    expect(next.queue.find((c) => c.id === 'c1')).toBeUndefined()
    expect(next.completed).toContain('c1')
  })

  it('does not touch remaining cards', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c1', true)
    expect(next.queue).toHaveLength(2)
  })
})

describe('answerCard — knew: false, confidence ≤ 5', () => {
  it('moves card to end of queue', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c1', false)
    expect(next.queue[next.queue.length - 1].id).toBe('c1')
    expect(next.completed).not.toContain('c1')
  })

  it('decrements confidence by 1', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c1', false)
    expect(next.queue.find((c) => c.id === 'c1')!.confidence).toBe(4)
  })

  it('clamps confidence at 1', () => {
    const card: ReviewCard = { id: 'x', term: 'T', definition: 'D', confidence: 1 }
    const s = initReviewSession([card])
    const next = answerCard(s, 'x', false)
    expect(next.queue[0].confidence).toBe(1)
  })

  it('does not add to requeuedHighConf', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c1', false)
    expect(next.requeuedHighConf).not.toContain('c1')
  })

  it('allows indefinite re-queuing', () => {
    const card: ReviewCard = { id: 'lc', term: 'T', definition: 'D', confidence: 3 }
    let s = initReviewSession([card])
    s = answerCard(s, 'lc', false)
    s = answerCard(s, 'lc', false)
    s = answerCard(s, 'lc', false)
    expect(s.queue).toHaveLength(1)
    expect(s.completed).not.toContain('lc')
  })
})

describe('answerCard — knew: false, confidence > 5', () => {
  it('re-queues card and records it in requeuedHighConf', () => {
    const s = initReviewSession(CARDS)
    const next = answerCard(s, 'c2', false)
    expect(next.queue[next.queue.length - 1].id).toBe('c2')
    expect(next.requeuedHighConf).toContain('c2')
  })

  it('retires card on second don-know (already requeued)', () => {
    const s = initReviewSession(CARDS)
    let next = answerCard(s, 'c2', false)
    expect(next.requeuedHighConf).toContain('c2')
    next = answerCard(next, 'c2', false)
    expect(next.completed).toContain('c2')
    expect(next.queue.find((c) => c.id === 'c2')).toBeUndefined()
  })
})

describe('isReviewComplete', () => {
  it('returns false for a new session', () => {
    expect(isReviewComplete(initReviewSession(CARDS))).toBe(false)
  })

  it('returns true when queue is empty', () => {
    let s = initReviewSession(CARDS)
    for (const card of CARDS) {
      s = answerCard(s, card.id, true)
    }
    expect(isReviewComplete(s)).toBe(true)
  })
})

describe('progressStats', () => {
  it('total stays constant as cards are answered', () => {
    let s = initReviewSession(CARDS)
    expect(progressStats(s).total).toBe(3)
    s = answerCard(s, 'c1', true)
    expect(progressStats(s).total).toBe(3)
    s = answerCard(s, 'c2', false)
    expect(progressStats(s).total).toBe(3)
  })

  it('reports completed and remaining', () => {
    let s = initReviewSession(CARDS)
    s = answerCard(s, 'c1', true)
    const stats = progressStats(s)
    expect(stats.completed).toBe(1)
    expect(stats.remaining).toBe(2)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- tests/review/session.test.ts
```

Expected: `FAIL` — "Cannot find module '@/lib/review/session'"

- [ ] **Step 4: Create `src/lib/review/session.ts`**

```typescript
export interface ReviewCard {
  id: string
  term: string
  definition: string
  confidence: number
}

export interface ReviewSession {
  queue: ReviewCard[]
  requeuedHighConf: string[]
  completed: string[]
}

export function initReviewSession(cards: ReviewCard[]): ReviewSession {
  return { queue: [...cards], requeuedHighConf: [], completed: [] }
}

export function currentCard(session: ReviewSession): ReviewCard | null {
  return session.queue[0] ?? null
}

export function answerCard(
  session: ReviewSession,
  cardId: string,
  knew: boolean
): ReviewSession {
  const card = session.queue.find((c) => c.id === cardId)
  if (!card) return session

  const rest = session.queue.filter((c) => c.id !== cardId)

  if (knew) {
    return { ...session, queue: rest, completed: [...session.completed, cardId] }
  }

  const alreadyRequeued = session.requeuedHighConf.includes(cardId)

  if (alreadyRequeued) {
    return { ...session, queue: rest, completed: [...session.completed, cardId] }
  }

  const updatedCard = { ...card, confidence: Math.max(1, card.confidence - 1) }
  const requeuedHighConf =
    card.confidence > 5
      ? [...session.requeuedHighConf, cardId]
      : session.requeuedHighConf

  return { queue: [...rest, updatedCard], requeuedHighConf, completed: session.completed }
}

export function isReviewComplete(session: ReviewSession): boolean {
  return session.queue.length === 0
}

export function progressStats(session: ReviewSession): {
  total: number
  completed: number
  remaining: number
} {
  const total = session.completed.length + session.queue.length
  return { total, completed: session.completed.length, remaining: session.queue.length }
}
```

- [ ] **Step 5: Run tests to verify they all pass**

```bash
npm test -- tests/review/session.test.ts
```

Expected: all 14 tests `PASS`

- [ ] **Step 6: Commit**

```bash
git add tests/review/session.test.ts src/lib/review/session.ts
git commit -m "feat: review session pure state machine with re-queue and high-confidence retirement logic"
```

---

### Task 4: Flashcard Carousel Components

**Files:**
- Create: `src/components/flashcard/FlashcardCarousel.tsx`
- Create: `src/components/flashcard/FlashcardSection.tsx`

**Interfaces:**
- Consumes: `{ id: string; term: string; definition: string }[]` passed as props
- Produces: `<FlashcardSection cards={...} />` — drop-in for server component pages

- [ ] **Step 1: Create `src/components/flashcard/FlashcardCarousel.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface FlashcardCarouselCard {
  id: string
  term: string
  definition: string
}

export default function FlashcardCarousel({ cards }: { cards: FlashcardCarouselCard[] }) {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const card = cards[index]

  function prev() {
    setFlipped(false)
    setIndex((i) => (i - 1 + cards.length) % cards.length)
  }

  function next() {
    setFlipped(false)
    setIndex((i) => (i + 1) % cards.length)
  }

  return (
    <div className="space-y-4">
      <div
        className="relative h-48 cursor-pointer select-none"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped((f) => !f)}
      >
        <div
          className="absolute inset-0 w-full h-full transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          <div
            className="absolute inset-0 rounded-xl border-2 bg-card flex flex-col items-center justify-center p-6 text-center gap-2"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Term</p>
            <p className="text-xl font-semibold">{card.term}</p>
          </div>
          <div
            className="absolute inset-0 rounded-xl border-2 border-primary/30 bg-muted flex flex-col items-center justify-center p-6 text-center gap-2"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Definition</p>
            <p className="text-base">{card.definition}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <Button variant="outline" size="sm" onClick={prev} disabled={cards.length <= 1}>
          ←
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {index + 1} / {cards.length}
        </span>
        <Button variant="outline" size="sm" onClick={next} disabled={cards.length <= 1}>
          →
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">Click card to flip</p>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/flashcard/FlashcardSection.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import FlashcardCarousel from './FlashcardCarousel'

interface FlashcardSectionProps {
  cards: { id: string; term: string; definition: string }[]
}

export default function FlashcardSection({ cards }: FlashcardSectionProps) {
  const [visible, setVisible] = useState(true)

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Flashcards
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setVisible((v) => !v)}
          className="text-xs h-7"
        >
          {visible ? 'Hide' : 'Show'}
        </Button>
      </div>
      {visible && <FlashcardCarousel cards={cards} />}
    </div>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/flashcard/
git commit -m "feat: FlashcardCarousel with flip animation and FlashcardSection with show/hide toggle"
```

---

### Task 5: Star Button + Updated Set Detail Page

**Files:**
- Create: `src/components/sets/StarButton.tsx`
- Modify: `src/app/sets/[id]/page.tsx`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `starCard` from `@/actions/confidence`; `FlashcardSection` from `@/components/flashcard/FlashcardSection`
- Produces: set detail page shows carousel above card list, star + confidence badge per card, "Review Mode" button

- [ ] **Step 1: Create `src/components/sets/StarButton.tsx`**

```tsx
'use client'

import { useTransition } from 'react'
import { starCard } from '@/actions/confidence'

interface StarButtonProps {
  cardId: string
  setId: string
  starred: boolean
}

export default function StarButton({ cardId, setId, starred }: StarButtonProps) {
  const [isPending, startTransition] = useTransition()

  function toggle() {
    startTransition(() => starCard(cardId, setId, !starred))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      className={[
        'text-xl leading-none transition-colors disabled:opacity-50',
        starred
          ? 'text-yellow-500'
          : 'text-muted-foreground hover:text-yellow-400',
      ].join(' ')}
      aria-label={starred ? 'Unstar card' : 'Star card'}
    >
      {starred ? '★' : '☆'}
    </button>
  )
}
```

- [ ] **Step 2: Replace `src/app/sets/[id]/page.tsx`**

```tsx
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { deleteSet } from '@/actions/sets'
import StarButton from '@/components/sets/StarButton'
import FlashcardSection from '@/components/flashcard/FlashcardSection'

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()

  const [set, progressList] = await Promise.all([
    prisma.set.findUnique({
      where: { id },
      include: { cards: { orderBy: { position: 'asc' } } },
    }),
    session?.user?.id
      ? prisma.cardProgress.findMany({
          where: { userId: session.user.id, card: { setId: id } },
          select: { cardId: true, confidence: true, starred: true },
        })
      : Promise.resolve([]),
  ])

  if (!set) notFound()

  const isOwner = session?.user?.id === set.userId
  const progressByCardId = new Map(progressList.map((p) => [p.cardId, p]))

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
              <Button variant="destructive" size="sm" type="submit">
                Delete
              </Button>
            </form>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-6">{set.cards.length} cards</p>

      <div className="flex gap-3 mb-8">
        <Button asChild>
          <Link href={`/sets/${id}/match`}>Matching Game</Link>
        </Button>
        {session?.user?.id && (
          <Button asChild variant="outline">
            <Link href={`/sets/${id}/review`}>Review Mode</Link>
          </Button>
        )}
      </div>

      {set.cards.length > 0 && (
        <FlashcardSection
          cards={set.cards.map((c) => ({
            id: c.id,
            term: c.term,
            definition: c.definition,
          }))}
        />
      )}

      <Separator className="mb-6" />

      <div className="space-y-3">
        {set.cards.map((card) => {
          const progress = progressByCardId.get(card.id)
          return (
            <Card key={card.id}>
              <CardContent className="pt-4 grid grid-cols-[1fr_1fr_auto] gap-4 items-start">
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                    Term
                  </p>
                  <p className="font-medium">{card.term}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                    Definition
                  </p>
                  <p>{card.definition}</p>
                </div>
                {session?.user?.id && (
                  <div className="flex flex-col items-center gap-2 pt-5">
                    <StarButton
                      cardId={card.id}
                      setId={id}
                      starred={progress?.starred ?? false}
                    />
                    <Badge variant="outline" className="text-xs font-mono px-1.5">
                      {progress?.confidence ?? 5}/10
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update `src/middleware.ts` to protect the review route**

Replace the `config` export:

```typescript
export const config = {
  matcher: ['/sets/new', '/sets/:id*/edit', '/sets/:id*/match', '/sets/:id*/review'],
}
```

- [ ] **Step 4: Verify the set detail page**

```bash
npm run dev
```

Navigate to a set. Verify:
1. Flashcard carousel appears above the card list with flip animation.
2. "Hide" button collapses it; "Show" restores it.
3. "Review Mode" button is visible (sign in first if not already).
4. Each card row shows a ☆ star button and a `5/10` confidence badge.
5. Clicking ☆ turns it yellow (★) and survives a page refresh.

- [ ] **Step 5: Commit**

```bash
git add src/components/sets/StarButton.tsx src/app/sets/[id]/page.tsx src/middleware.ts
git commit -m "feat: flashcard carousel + star button + confidence badge on set detail page"
```

---

### Task 6: Review Mode Page + UI

**Files:**
- Create: `src/components/review/ReviewSession.tsx`
- Create: `src/app/sets/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `ReviewCard`, `initReviewSession`, `currentCard`, `answerCard`, `isReviewComplete`, `progressStats` from `@/lib/review/session`
- Consumes: `recordReview` from `@/actions/confidence`
- Produces: `/sets/[id]/review` page with flip card and Know / Don't Know buttons

- [ ] **Step 1: Create `src/components/review/ReviewSession.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  initReviewSession,
  currentCard,
  answerCard,
  isReviewComplete,
  progressStats,
} from '@/lib/review/session'
import type { ReviewCard, ReviewSession as RS } from '@/lib/review/session'
import { recordReview } from '@/actions/confidence'

interface ReviewSessionProps {
  cards: ReviewCard[]
  setId: string
}

export default function ReviewSession({ cards, setId }: ReviewSessionProps) {
  const [session, setSession] = useState<RS>(() => initReviewSession(cards))
  const [flipped, setFlipped] = useState(false)
  const [isPending, startTransition] = useTransition()

  const card = currentCard(session)
  const done = isReviewComplete(session)
  const stats = progressStats(session)

  function handleAnswer(knew: boolean) {
    if (!card) return
    startTransition(async () => {
      await recordReview(card.id, knew)
      setSession((prev) => answerCard(prev, card.id, knew))
      setFlipped(false)
    })
  }

  if (done) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-5xl">✓</p>
        <h2 className="text-2xl font-bold">Review complete!</h2>
        <p className="text-muted-foreground">{stats.total} cards reviewed.</p>
        <div className="flex gap-3 justify-center">
          <Button
            onClick={() => {
              setSession(initReviewSession(cards))
              setFlipped(false)
            }}
          >
            Review again
          </Button>
          <Button asChild variant="outline">
            <Link href={`/sets/${setId}`}>Back to set</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (!card) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {stats.completed} / {stats.total} done
        </span>
        <span>Confidence: {card.confidence}/10</span>
      </div>

      <div
        className="relative h-56 cursor-pointer select-none"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped((f) => !f)}
      >
        <div
          className="absolute inset-0 w-full h-full transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          <div
            className="absolute inset-0 rounded-xl border-2 bg-card flex flex-col items-center justify-center p-6 text-center gap-3"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Term</p>
            <p className="text-xl font-semibold">{card.term}</p>
            <p className="text-xs text-muted-foreground mt-2">Click to reveal definition</p>
          </div>
          <div
            className="absolute inset-0 rounded-xl border-2 border-primary/30 bg-muted flex flex-col items-center justify-center p-6 text-center gap-3"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Definition</p>
            <p className="text-base">{card.definition}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Button
          variant="outline"
          className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
          onClick={() => handleAnswer(false)}
          disabled={isPending || !flipped}
        >
          Don't Know
        </Button>
        <Button
          className="bg-green-600 hover:bg-green-700 text-white"
          onClick={() => handleAnswer(true)}
          disabled={isPending || !flipped}
        >
          Know It
        </Button>
      </div>

      {!flipped && (
        <p className="text-center text-xs text-muted-foreground">
          Flip the card before answering
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `src/app/sets/[id]/review/page.tsx`**

```tsx
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import ReviewSession from '@/components/review/ReviewSession'

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect('/api/auth/signin')

  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      cards: {
        orderBy: { position: 'asc' },
        include: {
          progress: { where: { userId: session.user.id } },
        },
      },
    },
  })

  if (!set) notFound()

  if (set.cards.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground mb-4">No cards in this set yet.</p>
        <Button asChild>
          <Link href={`/sets/${id}/edit`}>Add cards</Link>
        </Button>
      </div>
    )
  }

  const reviewCards = set.cards.map((card) => ({
    id: card.id,
    term: card.term,
    definition: card.definition,
    confidence: card.progress[0]?.confidence ?? 5,
  }))

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link href={`/sets/${id}`}>← Back to {set.title}</Link>
        </Button>
        <h1 className="text-2xl font-bold">Review Mode</h1>
        <p className="text-sm text-muted-foreground mt-1">{reviewCards.length} cards</p>
      </div>
      <ReviewSession cards={reviewCards} setId={id} />
    </div>
  )
}
```

- [ ] **Step 3: Test review mode end-to-end**

```bash
npm run dev
```

1. Open a set with 4+ cards. Click "Review Mode."
2. Term is shown face-up. Know It / Don't Know buttons are disabled.
3. Click card → flips to show definition. Buttons become enabled.
4. Click "Know It" → next card appears face-down. Progress counter advances.
5. Click "Don't Know" on a card with confidence 5 → card re-appears later in the cycle.
6. Click "Don't Know" twice on a card with confidence 7 → card is retired after the second wrong answer.
7. Complete all cards → victory screen shows total count.
8. "Review again" → session resets with original cards from props.
9. Open Prisma Studio (`npm run db:studio`) → confirm `CardProgress` rows updated and `ConfidenceEvent` rows created for each answer.

- [ ] **Step 4: Commit**

```bash
git add src/components/review/ src/app/sets/[id]/review/
git commit -m "feat: review mode with flip card, know/don't-know cycling, and confidence persistence"
```

---

### Task 7: Run All Tests + Final Verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests in `tests/parser/import.test.ts`, `tests/game/match.test.ts`, and `tests/review/session.test.ts` pass.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: build completes without errors.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

Walk through:
1. Sign in. Open any set.
2. Flashcard carousel is visible above the card list. Click through prev/next. Click a card — it flips. Click "Hide" — carousel collapses. Click "Show" — it returns.
3. Star two cards (☆ → ★). Refresh the page — stars persist.
4. Confidence badges all show default `5/10`.
5. Click "Review Mode." Go through all cards answering a mix of Know and Don't Know. Verify low-confidence cards cycle back; a card with confidence 7 comes back at most once after a Don't Know.
6. After completing a session, open Prisma Studio and inspect `CardProgress` (confidence updated) and `ConfidenceEvent` (one row per answer).
7. Start a second review session for the same set — confidence values now reflect prior session answers.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: Stage 2 complete — confidence memory, flashcard carousel, review mode"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Star/flag cards — Task 2 (`starCard`), Task 5 (`StarButton`)
- [x] 1–10 confidence scale persisted per user per card — Task 1 (`CardProgress`), Task 2 (`recordReview`)
- [x] Confidence history queryable for Stage 3 AI — Task 1 (`ConfidenceEvent` with `@@index([userId, createdAt])`)
- [x] Flashcard carousel view above term list — Task 4 (`FlashcardCarousel`), Task 5 (set detail page)
- [x] Flashcard show/hide toggle — Task 4 (`FlashcardSection`)
- [x] Review mode with Know / Don't Know — Task 6 (`ReviewSession`, review page)
- [x] Re-queue "don't know" cards — Task 3 (`answerCard` logic)
- [x] High-confidence (> 5) cards re-appear at most once — Task 3 (`requeuedHighConf` tracking)
- [x] Confidence updated after each review answer — Task 2 (`recordReview`), Task 6 (`ReviewSession` calls it)

**Placeholder scan:** No TODOs, TBDs, or "similar to above" references. All code blocks are complete.

**Type consistency:**
- `ReviewCard` defined in Task 3 (`session.ts`), consumed unchanged in Tasks 6 (`ReviewSession.tsx`) and Task 6 (review page)
- `ReviewSession` interface defined in Task 3, consumed in Task 6
- `starCard(cardId, setId, starred)` signature defined in Task 2, consumed in Task 5 (`StarButton`)
- `recordReview(cardId, knew)` defined in Task 2, consumed in Task 6 (`ReviewSession`)
- `CardProgress.@@unique([userId, cardId])` — the upsert `where` clause in Task 2 matches this exactly
