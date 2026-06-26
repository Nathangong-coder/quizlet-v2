'use client'

import React, { useState, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { parseImport, ParsedCard } from '@/lib/parser/import'
import { Import, FileUp, AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ImportDialogProps {
  onImport: (cards: ParsedCard[]) => void
}

export function ImportDialog({ onImport }: ImportDialogProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      setText(content)
    } catch (err) {
      setError('Failed to read file')
    }
  }

  const handleImport = () => {
    setError(null)
    try {
      const cards = parseImport(text)
      onImport(cards)
      setText('')
      setOpen(false)
    } catch (e: any) {
      setError(e.message || 'An error occurred while parsing the import text.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <Import className="h-4 w-4" />
        Import cards
      </Button>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Import Cards</DialogTitle>
          <DialogDescription>
            Paste your cards below or upload a .txt file.
            Format: term | definition; separated by semicolons.
            New lines are preserved within cards.
            Example: <code className="bg-muted px-1 rounded">Net Income | Total revenue minus total expenses;EBITDA | Earnings before...</code>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Import Text</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="h-3 w-3" />
              Upload .txt
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".txt"
              onChange={handleFileChange}
            />
          </div>
          <Textarea
            placeholder="Term | Definition; Term 2 | Definition 2..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[200px] max-h-[400px] overflow-y-auto font-mono text-sm"
          />
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!text.trim()}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
