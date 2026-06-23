'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { CardRow } from './CardRow'
import { ImportDialog } from './ImportDialog'
import { createSet, updateSet } from '@/actions/sets'
import { ParsedCard } from '@/lib/parser/import'
import { Plus, Loader2 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

interface SetFormProps {
  mode: 'create' | 'edit'
  initialTitle?: string
  initialDescription?: string
  initialCards?: { term: string; definition: string; position: number }[]
  setId?: string
}

export function SetForm({
  mode,
  initialTitle = '',
  initialDescription = '',
  initialCards = [],
  setId,
}: SetFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [cards, setCards] = useState(
    initialCards.map((c, i) => ({ term: c.term, definition: c.definition, position: i }))
  )

  const addCard = () => {
    setCards([...cards, { term: '', definition: '', position: cards.length }])
  }

  const removeCard = (index: number) => {
    setCards(cards.filter((_, i) => i !== index).map((c, i) => ({ ...c, position: i })))
  }

  const updateCard = (index: number, field: 'term' | 'definition', value: string) => {
    const newCards = [...cards]
    newCards[index] = { ...newCards[index], [field]: value }
    setCards(newCards)
  }

  const handleImport = (importedCards: ParsedCard[]) => {
    const formattedImported = importedCards.map((c, i) => ({
      ...c,
      position: cards.length + i,
    }))
    setCards([...cards, ...formattedImported])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (cards.length === 0) {
      toast.error('At least one card is required')
      return
    }

    startTransition(async () => {
      try {
        const result = mode === 'create'
          ? await createSet({ title, description, cards })
          : await updateSet(setId!, { title, description, cards })

        if (result.success) {
          toast.success(mode === 'create' ? 'Set created!' : 'Set updated!')
          router.push(`/sets/${result.data?.setId}`)
          router.refresh()
        } else {
          toast.error(result.error || 'An error occurred')
        }
      } catch (error) {
        toast.error('An unexpected error occurred')
        console.error(error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="title" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Set Title
          </label>
          <Input
            id="title"
            placeholder="e.g., Finance Interview Prep - Valuation"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="text-lg font-semibold"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="description" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Description (optional)
          </label>
          <Textarea
            id="description"
            placeholder="Describe what this set covers..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="resize-none"
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Cards</h3>
          <div className="flex gap-2">
            <ImportDialog onImport={handleImport} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCard}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add card
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {cards.map((card, index) => (
            <CardRow
              key={index}
              index={index}
              term={card.term}
              definition={card.definition}
              onChange={updateCard}
              onRemove={removeCard}
              canRemove={cards.length > 1}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending} className="gap-2">
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === 'create' ? 'Create Set' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}
