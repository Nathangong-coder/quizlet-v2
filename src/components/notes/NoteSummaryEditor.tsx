'use client'

import { useRef, useState, useTransition } from 'react'
import type { ReactNode, Ref } from 'react'
import { Highlighter, Loader2, MessageSquarePlus, Plus, RefreshCw, Save, Sparkles } from 'lucide-react'
import { analyzeStudyNote, updateStudyNoteDocument } from '@/actions/study-notes'
import type { StudyNoteStoredAnalysis } from '@/lib/ai/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type SummaryLine = StudyNoteStoredAnalysis['summaryLines'][number]
type NoteAnnotation = StudyNoteStoredAnalysis['annotations'][number]

const KIND_LABELS: Record<SummaryLine['kind'], string> = {
  insight: 'Insight',
  definition: 'Definition',
  question: 'Question',
  action: 'Action',
}

function annotationFor(annotations: NoteAnnotation[], line: { id: string; highlighted?: boolean; comment?: string }): NoteAnnotation {
  return annotations.find((annotation) => annotation.lineId === line.id) ?? {
    lineId: line.id,
    highlighted: line.highlighted ?? false,
    comment: line.comment ?? '',
  }
}

export function NoteSummaryEditor({ noteId, body, analysis }: { noteId: string; body: string; analysis: StudyNoteStoredAnalysis | null }) {
  const [sourceLines, setSourceLines] = useState(() => body.split(/\r?\n/))
  const [summaryLines, setSummaryLines] = useState<SummaryLine[]>(() => analysis?.summaryLines ?? [])
  const [annotations, setAnnotations] = useState<NoteAnnotation[]>(() => analysis?.annotations ?? [])
  const [commentOpen, setCommentOpen] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const sourceRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  function analyze() {
    setMessage(null)
    startTransition(async () => {
      const result = await analyzeStudyNote(noteId)
      if (result.success) window.location.reload()
      else setMessage(result.detail?.why ? `${result.error}: ${result.detail.why}` : result.error)
    })
  }

  function setAnnotation(lineId: string, patch: Partial<NoteAnnotation>) {
    setAnnotations((current) => {
      const existing = current.find((annotation) => annotation.lineId === lineId)
      if (existing) return current.map((annotation) => annotation.lineId === lineId ? { ...annotation, ...patch } : annotation)
      return [...current, { lineId, highlighted: false, comment: '', ...patch }]
    })
    if (!lineId.startsWith('source-')) {
      setSummaryLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line))
    }
  }

  function updateSummaryLine(index: number, patch: Partial<SummaryLine>) {
    setSummaryLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))
  }

  function save() {
    setMessage(null)
    startTransition(async () => {
      const result = await updateStudyNoteDocument(noteId, {
        body: sourceLines.join('\n'),
        summaryLines,
        annotations,
      })
      setMessage(result.success ? 'Note edits saved' : result.error)
    })
  }

  function addSummaryLine() {
    setSummaryLines((current) => [...current, {
      id: `summary-${Date.now()}`,
      text: '',
      kind: 'insight',
      highlighted: false,
      comment: '',
    }])
  }

  if (!analysis) {
    return (
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8">
          <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Source note</h2><Badge variant="outline">{sourceLines.length} lines</Badge></div>
          <p className="whitespace-pre-wrap text-base leading-8">{body}</p>
        </section>
        <section className="rounded-xl border border-primary/20 bg-primary/[0.035] p-6 sm:p-7">
          <div className="flex items-start gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Sparkles className="h-5 w-5" aria-hidden="true" /></div><div><h2 className="font-semibold">Build an editable study layer</h2><p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">AI will keep this source note intact, then append a separate set of summary lines at the bottom. You can edit, highlight, and annotate the combined document afterward.</p></div></div>
          {message && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{message}</p>}
          <Button className="mt-6" onClick={analyze} disabled={isPending}>{isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}{isPending ? 'Analyzing…' : 'Analyze with AI'}</Button>
          <p className="mt-3 text-xs text-muted-foreground">Uses the AI credential configured in Settings → AI. No configured credential means analysis returns an actionable error.</p>
        </section>
      </div>
    )
  }

  return (
    <section className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5"><div><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /><h2 className="font-semibold">Editable study note</h2></div><p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">The source stays first. AI additions live at the bottom, and every line in this document can be edited, highlighted, or annotated.</p></div><Button variant="outline" size="sm" onClick={analyze} disabled={isPending}><RefreshCw className="h-4 w-4" aria-hidden="true" />Regenerate additions</Button></div>

      <div className="space-y-3">
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-foreground/50" /><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Original note</p><span className="text-xs text-muted-foreground">{sourceLines.length} lines</span></div>
        {sourceLines.map((line, index) => {
          const id = `source-${index}`
          const annotation = annotationFor(annotations, { id })
          return <DocumentLine key={id} id={id} text={line} label="Original" highlighted={annotation.highlighted} comment={annotation.comment} textareaRef={(node) => { sourceRefs.current[id] = node }} onTextChange={(text) => setSourceLines((current) => current.map((value, lineIndex) => lineIndex === index ? text : value))} onHighlightChange={(highlighted) => setAnnotation(id, { highlighted })} onCommentChange={(comment) => setAnnotation(id, { comment })} commentOpen={commentOpen === id} onToggleComment={() => setCommentOpen(commentOpen === id ? null : id)} />
        })}
      </div>

      <div className="space-y-3 border-t border-dashed border-border pt-6">
        <div className="flex flex-wrap items-center gap-2"><span className="h-2 w-2 rounded-full bg-primary" /><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">AI additions</p><Badge variant="secondary">never replaces source text</Badge></div>
        {summaryLines.length === 0 && <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No additions yet. Add one below or regenerate the analysis.</p>}
        {summaryLines.map((line, index) => {
          const annotation = annotationFor(annotations, line)
          return <DocumentLine key={line.id} id={line.id} text={line.text} label={KIND_LABELS[line.kind]} highlighted={annotation.highlighted} comment={annotation.comment} badge={<>{line.sourceLine !== undefined && <span className="text-xs text-muted-foreground">from line {line.sourceLine + 1}</span>}</>} onTextChange={(text) => updateSummaryLine(index, { text })} onHighlightChange={(highlighted) => setAnnotation(line.id, { highlighted })} onCommentChange={(comment) => setAnnotation(line.id, { comment })} commentOpen={commentOpen === line.id} onToggleComment={() => setCommentOpen(commentOpen === line.id ? null : line.id)} />
        })}
        <Button type="button" variant="ghost" size="sm" onClick={addSummaryLine}><Plus className="h-4 w-4" aria-hidden="true" />Add line to study note</Button>
      </div>

      {analysis.suggestions.length > 0 && <div className="space-y-3 border-t border-border pt-6"><div><div className="flex items-center gap-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">AI suggestions</p><Badge variant="outline">review only</Badge></div><p className="mt-1 text-sm leading-relaxed text-muted-foreground">These are possible trims, not automatic edits. The source text remains untouched until you choose to edit it yourself.</p></div>{analysis.suggestions.map((suggestion) => <div key={suggestion.id} className="rounded-lg border border-amber-400/40 bg-amber-300/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium">“{suggestion.excerpt}”</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{suggestion.rationale}</p></div><Button type="button" variant="outline" size="sm" onClick={() => sourceRefs.current[`source-${suggestion.sourceLine}`]?.focus()}>Review line {suggestion.sourceLine + 1}</Button></div></div>)}</div>}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">{message && <span role="status" className="text-xs text-muted-foreground">{message}</span>}<Button type="button" onClick={save} disabled={isPending || summaryLines.some((line) => !line.text.trim())}>{isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{isPending ? 'Saving…' : 'Save note edits'}</Button></div>
    </section>
  )
}

function DocumentLine({ id, text, label, highlighted, comment, badge, textareaRef, onTextChange, onHighlightChange, onCommentChange, commentOpen, onToggleComment }: {
  id: string
  text: string
  label: string
  highlighted: boolean
  comment: string
  badge?: ReactNode
  textareaRef?: Ref<HTMLTextAreaElement>
  onTextChange: (text: string) => void
  onHighlightChange: (highlighted: boolean) => void
  onCommentChange: (comment: string) => void
  commentOpen: boolean
  onToggleComment: () => void
}) {
  return <div className={`rounded-lg border p-3 transition-colors sm:p-4 ${highlighted ? 'border-amber-400/60 bg-amber-300/15 dark:border-amber-300/40 dark:bg-amber-300/10' : 'border-border/80 bg-muted/10'}`}><div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="outline">{label}</Badge>{badge}<span className="sr-only">Document line {id}</span></div><Textarea ref={textareaRef} aria-label={`${label} text`} value={text} onChange={(event) => onTextChange(event.target.value)} rows={text.length > 100 ? 3 : 2} className="min-h-14 resize-y border-0 bg-transparent px-0 py-1 leading-7 shadow-none focus-visible:ring-0" /><div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/70 pt-2"><button type="button" aria-pressed={highlighted} onClick={() => onHighlightChange(!highlighted)} className={`inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-xs font-semibold transition-colors ${highlighted ? 'bg-amber-300/30 text-amber-900 dark:text-amber-100' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Highlighter className="h-3.5 w-3.5" aria-hidden="true" />{highlighted ? 'Highlighted' : 'Highlight'}</button><button type="button" aria-expanded={commentOpen} onClick={onToggleComment} className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />{comment ? 'Edit comment' : 'Annotate'}</button></div>{commentOpen && <div className="mt-3"><label htmlFor={`comment-${id}`} className="mb-1.5 block text-xs font-semibold text-muted-foreground">Your comment</label><Textarea id={`comment-${id}`} value={comment} onChange={(event) => onCommentChange(event.target.value)} placeholder="What should I remember or connect this to?" rows={2} maxLength={2000} /></div>}</div>
}
