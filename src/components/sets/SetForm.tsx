'use client'

import React, { useState, useTransition, useMemo } from 'react'
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
import { contentBlocksToPlainText, legacyCardToContentBlocks, normalizeTextMarks } from '@/lib/cards/content'
import { CategoryManager } from './CategoryManager'
import { normalizeCategoryName, pickDefaultColor } from '@/lib/cards/categories'

interface InitialContentBlock {
  id?: string
  side?: string | null
  type?: string | null
  text?: string | null
  assetId?: string | null
  position?: number
  listType?: string | null
  indent?: number | null
  marks?: unknown
}

interface InitialCard {
  id?: string
  term: string
  definition: string
  position: number
  contentBlocks?: InitialContentBlock[]
  categoryNames?: string[]
}

interface SetFormProps {
  mode: 'create' | 'edit'
  initialTitle?: string
  initialDescription?: string
  initialCards?: InitialCard[]
  initialCategories?: { name: string; color?: string | null }[]
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
        listType: (b.listType === 'bullet' || b.listType === 'numbered' ? b.listType : null) as ContentBlock['listType'],
        indent: b.indent ?? 0,
        marks: normalizeTextMarks(b.marks, (b.text ?? '').length),
        position: i,
        side,
      }))

    if (blocks.length > 0) return blocks
    return [{ id: `${Date.now()}-${Math.random()}`, type: 'text', text: fallback, position: 0, side, listType: null, indent: 0, marks: [] }]
  }

  return {
    id: card.id,
    term: forSide('term', card.term),
    definition: forSide('definition', card.definition),
    categoryNames: card.categoryNames ?? [],
    position: card.position,
  }
}

function hasTypedText(blocks: ContentBlock[]) {
  return blocks.some((block) => block.type === 'text' && Boolean(block.text?.trim()))
}

function withGeneratedText(blocks: ContentBlock[], text: string, side: 'term' | 'definition') {
  const textIndex = blocks.findIndex((block) => block.type === 'text')
  if (textIndex >= 0) {
    return blocks.map((block, index) => (index === textIndex ? { ...block, text, marks: [] } : block))
  }

  return [
    { id: `${Date.now()}-${Math.random()}`, type: 'text' as const, text, position: 0, side },
    ...blocks.map((block, index) => ({ ...block, position: index + 1 })),
  ]
}

export function SetForm({
  mode,
  initialTitle = '',
  initialDescription = '',
  initialCards = [],
  initialCategories = [],
  setId,
}: SetFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isUploading, setIsUploading] = useState(false)

  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [cards, setCards] = useState(
    initialCards.map((c, i) => ({
      ...cardToEditorBlocks(c),
      position: i,
    }))
  )

  const [categoryMeta, setCategoryMeta] = useState<{ name: string; color: string }[]>(() => {
    const metas: { name: string; color: string }[] = []
    for (const c of initialCategories) {
      metas.push({ name: c.name, color: c.color ?? pickDefaultColor(metas.map((m) => m.color)) })
    }
    return metas
  })

  const addCard = () => {
    setCards([...cards, {
      id: undefined as string | undefined,
      term: [{ id: `${Date.now()}-${Math.random()}-term`, type: 'text', text: '', position: 0, listType: null, indent: 0, marks: [] }],
      definition: [{ id: `${Date.now()}-${Math.random()}-definition`, type: 'text', text: '', position: 0, listType: null, indent: 0, marks: [] }],
      categoryNames: [],
      position: cards.length
    }])
  }

  const removeCard = (index: number) => {
    setCards(cards.filter((_, i) => i !== index).map((c, i) => ({ ...c, position: i })))
  }

  const updateCard = (index: number, side: 'term' | 'definition', blocks: ContentBlock[]) => {
    setCards((prev) =>
      prev.map((card, cardIndex) => (cardIndex === index ? { ...card, [side]: blocks } : card)),
    )
  }

  const fillCard = (index: number, term: string, definition: string) => {
    setCards((prev) =>
      prev.map((card, cardIndex) => {
        if (cardIndex !== index) return card

        return {
          ...card,
          // Never replace text the learner already supplied. This also means
          // both sides can safely be returned for a one-sided completion.
          term: hasTypedText(card.term) ? card.term : withGeneratedText(card.term, term, 'term'),
          definition: hasTypedText(card.definition)
            ? card.definition
            : withGeneratedText(card.definition, definition, 'definition'),
        }
      }),
    )
  }

  const handleCategoriesChange = (index: number, names: string[]) => {
    setCards((prev) => prev.map((c, i) => (i === index ? { ...c, categoryNames: names } : c)))
  }

  const handleCreateCategory = (name: string) => {
    setCategoryMeta((prev) => {
      if (prev.some((m) => normalizeCategoryName(m.name) === normalizeCategoryName(name))) return prev
      return [...prev, { name: name.trim(), color: pickDefaultColor(prev.map((m) => m.color)) }]
    })
  }

  const handleRenameCategory = (oldName: string, newNameRaw: string) => {
    const newName = newNameRaw.trim()
    if (!newName) return
    const oldNorm = normalizeCategoryName(oldName)
    const newNorm = normalizeCategoryName(newName)

    setCards((prev) =>
      prev.map((c) => {
        const replaced = c.categoryNames.map((n) =>
          normalizeCategoryName(n) === oldNorm ? newName : n,
        )
        const deduped = Array.from(
          new Map(replaced.map((n) => [normalizeCategoryName(n), n])).values(),
        )
        return { ...c, categoryNames: deduped }
      }),
    )

    setCategoryMeta((prev) => {
      const collides = oldNorm !== newNorm && prev.some((m) => normalizeCategoryName(m.name) === newNorm)
      if (collides) {
        // merge: drop the renamed-away entry, keep the existing target
        return prev.filter((m) => normalizeCategoryName(m.name) !== oldNorm)
      }
      return prev.map((m) => (normalizeCategoryName(m.name) === oldNorm ? { ...m, name: newName } : m))
    })
  }

  const handleRecolorCategory = (name: string, color: string) => {
    setCategoryMeta((prev) =>
      prev.map((m) => (normalizeCategoryName(m.name) === normalizeCategoryName(name) ? { ...m, color } : m)),
    )
  }

  const handleDeleteCategory = (name: string) => {
    const norm = normalizeCategoryName(name)
    setCategoryMeta((prev) => prev.filter((m) => normalizeCategoryName(m.name) !== norm))
    setCards((prev) =>
      prev.map((c) => ({ ...c, categoryNames: c.categoryNames.filter((n) => normalizeCategoryName(n) !== norm) })),
    )
  }

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of cards) {
      for (const n of c.categoryNames) {
        const k = normalizeCategoryName(n)
        counts[k] = (counts[k] ?? 0) + 1
      }
    }
    return counts
  }, [cards])

  const handleImport = (importedCards: ParsedCard[]) => {
    const formattedImported = importedCards.map((c, i) => ({
      id: undefined as string | undefined,
      ...legacyCardToContentBlocks(c.term, c.definition),
      categoryNames: [],
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
          id: c.id,
          term: contentBlocksToPlainText(c.term),
          definition: contentBlocksToPlainText(c.definition),
          termBlocks: c.term,
          definitionBlocks: c.definition,
          categoryNames: c.categoryNames,
          position: c.position
        }))

        const payload = {
          title,
          description,
          cards: cardsForApi,
          categories: categoryMeta.map((m) => ({ name: m.name, color: m.color })),
        }

        const result = mode === 'create'
          ? await createSet(payload)
          : await updateSet(setId!, payload)

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
    <form onSubmit={handleSubmit} className="w-full max-w-none space-y-8">
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

        {categoryMeta.length > 0 && (
          <CategoryManager
            categories={categoryMeta}
            counts={categoryCounts}
            onRename={handleRenameCategory}
            onRecolor={handleRecolorCategory}
            onDelete={handleDeleteCategory}
          />
        )}

        <div className="space-y-5">
          {cards.map((card, index) => (
            <CardRow
              key={index}
              index={index}
              cardId={card.id}
              termBlocks={card.term}
              definitionBlocks={card.definition}
              categoryNames={card.categoryNames}
              availableCategories={categoryMeta}
              onChange={updateCard}
              onCategoriesChange={handleCategoriesChange}
              onCreateCategory={handleCreateCategory}
              onFillCard={fillCard}
              onRemove={removeCard}
              onUploadStatusChange={setIsUploading}
              canRemove={cards.length > 1}
              setId={setId || 'new'}
            />
          ))}
        </div>

        <div className="border-t border-dashed border-border/80 pt-4">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={addCard}
            className="w-full gap-2 border-dashed"
          >
            <Plus className="h-4 w-4" />
            Add a card
          </Button>
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
