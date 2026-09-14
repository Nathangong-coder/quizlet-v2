'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Star, Clock, TrendingDown, Shuffle, ListOrdered, ArrowDownWideNarrow } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DEFAULT_REVIEW_SETUP, selectReviewCards, setupCounts, type ReviewCardInput, type ReviewSetup } from '@/lib/review/setup'
import { freshSeed } from '@/lib/games/rng'
import ReviewSession from '@/components/review/ReviewSession'

interface Category {
  id: string
  name: string
  color: string | null
}

/**
 * Review mode, built out (owner, 2026-09-14): a setup screen before the deck
 * — starred / due / weak, categories, which side first, the order — then the
 * session, then a summary with "review the ones I missed". The deck is a pure
 * function of the setup (`selectReviewCards`), so the count on the button is
 * the deck you get.
 */
export function ReviewMode({ cards, categories, setId, now }: { cards: ReviewCardInput[]; categories: Category[]; setId: string; now: number }) {
  const [setup, setSetup] = useState<ReviewSetup>(DEFAULT_REVIEW_SETUP)
  const [deck, setDeck] = useState<{ cards: ReviewCardInput[]; key: number } | null>(null)

  const counts = setupCounts(cards, setup, now)
  const deckSize = selectReviewCards(cards, setup, now).length

  function start(seed: number) {
    setDeck({ cards: selectReviewCards(cards, setup, now, seed), key: seed })
  }

  if (deck) {
    return (
      <ReviewSession
        key={deck.key}
        cards={deck.cards}
        setId={setId}
        setup={setup}
        onRestart={(ids) => {
          const seed = freshSeed()
          const subset = ids ? deck.cards.filter((c) => ids.includes(c.id)) : selectReviewCards(cards, setup, now, seed)
          setDeck({ cards: subset, key: seed })
        }}
        onChangeSetup={() => setDeck(null)}
      />
    )
  }

  const toggle = (key: 'starredOnly' | 'dueOnly' | 'weakOnly') => setSetup((s) => ({ ...s, [key]: !s[key] }))

  return (
    <div className="space-y-6">
      <section aria-labelledby="which-cards">
        <h2 id="which-cards" className="label mb-2">Which cards</h2>
        <div className="flex flex-wrap gap-2">
          <Chip on={setup.starredOnly} onClick={() => toggle('starredOnly')} icon={Star} label="Starred" count={counts.starred} />
          <Chip on={setup.dueOnly} onClick={() => toggle('dueOnly')} icon={Clock} label="Due now" count={counts.due} />
          <Chip on={setup.weakOnly} onClick={() => toggle('weakOnly')} icon={TrendingDown} label="Weak (≤ 4)" count={counts.weak} />
        </div>
        {categories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Categories">
            {categories.map((c) => {
              const on = setup.categoryIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSetup((s) => ({ ...s, categoryIds: on ? s.categoryIds.filter((x) => x !== c.id) : [...s.categoryIds, c.id] }))}
                  className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium', on ? 'border-primary bg-accent' : 'border-border hover:border-primary/50')}
                >
                  {c.color && <span className="h-2 w-2 rounded-full" style={{ background: c.color }} aria-hidden="true" />}
                  {c.name}
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="which-side" className="grid gap-4 sm:grid-cols-2">
        <div>
          <h2 id="which-side" className="label mb-2">Show first</h2>
          <Segmented
            value={setup.side}
            onChange={(side) => setSetup((s) => ({ ...s, side: side as ReviewSetup['side'] }))}
            options={[
              { value: 'term', label: 'Term' },
              { value: 'definition', label: 'Definition' },
              { value: 'mixed', label: 'Mixed' },
            ]}
          />
        </div>
        <div>
          <h2 className="label mb-2">Order</h2>
          <Segmented
            value={setup.order}
            onChange={(order) => setSetup((s) => ({ ...s, order: order as ReviewSetup['order'] }))}
            options={[
              { value: 'set', label: 'Set order', icon: ListOrdered },
              { value: 'shuffle', label: 'Shuffle', icon: Shuffle },
              { value: 'weakest', label: 'Weakest first', icon: ArrowDownWideNarrow },
            ]}
          />
        </div>
      </section>

      <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
        Flip the card, then say whether you knew it. What you did not know comes back until you do; a card you were already confident about gets one more look. Every answer moves your confidence on that card by one step.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={() => start(freshSeed())} disabled={deckSize === 0}>
          Start review · {deckSize} {deckSize === 1 ? 'card' : 'cards'}
        </Button>
        {deckSize === 0 && <span className="text-sm text-muted-foreground">Nothing matches — loosen a filter.</span>}
        <Link href={`/sets/${setId}`} className={cn(buttonVariants({ variant: 'ghost' }))}>Back to the set</Link>
      </div>
    </div>
  )
}

function Chip({ on, onClick, icon: Icon, label, count }: { on: boolean; onClick: () => void; icon: typeof Star; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium', on ? 'border-primary bg-accent' : 'border-border hover:border-primary/50')}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  )
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; icon?: typeof Star }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', value === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.icon && <o.icon className="h-3.5 w-3.5" aria-hidden="true" />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
