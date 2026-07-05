'use client'

import React, { useState, useTransition, useEffect } from 'react'
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
import { ContentBlock } from '@/lib/cards/content'
import { contentBlocksToPlainText, legacyCardToContentBlocks } from '@/lib/cards/content'

interface InitialContentBlock {
  id?: string
  side?: string | null
  type?: string | null
  text?: string | null
  assetId?: string | null
  position?: number
}

interface InitialCard {
  term: string
  definition: string
  position: number
  contentBlocks?: InitialContentBlock[]
}

interface SetFormProps {
  mode: 'create' | 'edit'
  initialTitle?: string
  initialDescription?: string
  initialCards?: InitialCard[]
  setId?: string
}

/**
 * Build the editor's initial per-side blocks for a card. When the card has
 * stored content blocks (images, files, mixed text+media), we hydrate those so
 * editing preserves them. Only when a side has no stored blocks do we fall back
 * to wrapping the legacy plain-text term/definition in a single text block.
 */
function cardToEditorBlocks(card: InitialCard) {
  const stored = card.contentBlocks ?? []

  const forSide = (side: 'term' | 'definition', fallback: string): ContentBlock[] => {
    const blocks = stored
      .filter((b) => b.side === side)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((b, i) => ({
        id: b.id ?? `${Date.now()}-${Math.random()}`,
        type: (b.type as ContentBlock['type']) ?? 'text',
        text: b.text ?? undefined,
        assetId: b.assetId ?? undefined,
        position: i,
        side,
      }))

    if (blocks.length > 0) return blocks
    return [{ id: `${Date.now()}-${Math.random()}`, type: 'text', text: fallback, position: 0, side }]
  }

  return {
    term: forSide('term', card.term),
    definition: forSide('definition', card.definition),
    position: card.position,
  }
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
  const [isUploading, setIsUploading] = useState(false)

  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [categories, setCategories] = useState<string[]>([])
  const [cards, setCards] = useState(
    initialCards.map((c, i) => ({
      ...cardToEditorBlocks(c),
      position: i,
    }))
  )

  useEffect(() => {
    if (mode === 'edit' && setId) {
      // In a real app, we'd fetch categories for the set here.
      // For now, we'll use a placeholder or fetch via a server action if available.
      setCategories([]);
    }
  }, [mode, setId]);

  const addCard = () => {
    setCards([...cards, {
      term: [{ type: 'text', text: '', position: 0 }],
      definition: [{ type: 'text', text: '', position: 0 }],
      position: cards.length
    }])
  }

  const removeCard = (index: number) => {
    setCards(cards.filter((_, i) => i !== index).map((c, i) => ({ ...c, position: i })))
  }

  const updateCard = (index: number, side: 'term' | 'definition', blocks: ContentBlock[]) => {
    const newCards = [...cards]
    newCards[index] = { ...newCards[index], [side]: blocks }
    setCards(newCards)
  }

  const handleImport = (importedCards: ParsedCard[]) => {
    const formattedImported = importedCards.map((c, i) => ({
      ...legacyCardToContentBlocks(c.term, c.definition),
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
        const cardsForApi = cards.map(c => ({
          term: contentBlocksToPlainText(c.term),
          definition: contentBlocksToPlainText(c.definition),
          termBlocks: c.term,
          definitionBlocks: c.definition,
          position: c.position
        }))

        const result = mode === 'create'
          ? await createSet({ title, description, cards: cardsForApi })
          : await updateSet(setId!, { title, description, cards: cardsForApi })

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
              termBlocks={card.term}
              definitionBlocks={card.definition}
              onChange={updateCard}
              onRemove={removeCard}
              onUploadStatusChange={setIsUploading}
              canRemove={cards.length > 1}
              setId={setId || 'new'}
              categories={categories}
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
        <Button type="submit" disabled={isPending || isUploading} className="gap-2" title={isUploading ? "Waiting for file uploads to complete..." : ""}>
          {(isPending || isUploading) && <Loader2 className="h-4 w-4 animate-spin" />}
          {isUploading ? 'Uploading...' : (mode === 'create' ? 'Create Set' : 'Save Changes')}
        </Button>
      </div>
    </form>
  )
}
