'use client'

import { useState, useTransition } from 'react'
import { Highlighter, Loader2, MessageSquarePlus, Plus, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'
import { analyzeStudyNote, updateStudyNoteSummary } from '@/actions/study-notes'
import type { StudyNoteStoredAnalysis } from '@/lib/ai/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type SummaryLine = StudyNoteStoredAnalysis['summaryLines'][number]

const KIND_LABELS: Record<SummaryLine['kind'], string> = {
  insight: 'Insight',
  definition: 'Definition',
  question: 'Question',
  action: 'Action',
}

export function NoteSummaryEditor({ noteId, analysis }: { noteId: string; analysis: StudyNoteStoredAnalysis | null }) {
  const [lines, setLines] = useState<SummaryLine[]>(analysis?.summaryLines ?? [])
  const [commentOpen, setCommentOpen] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function analyze() {
    setMessage(null)
    startTransition(async () => {
      const result = await analyzeStudyNote(noteId)
      if (result.success) window.location.reload()
      else setMessage(result.detail?.why ? `${result.error}: ${result.detail.why}` : result.error)
    })
  }

  function save() {
    setMessage(null)
    startTransition(async () => {
      const result = await updateStudyNoteSummary(noteId, lines)
      setMessage(result.success ? 'Summary edits saved' : result.error)
    })
  }

  function updateLine(index: number, patch: Partial<SummaryLine>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))
  }

  if (!analysis) {
    return (
      <section className="rounded-xl border border-primary/20 bg-primary/[0.035] p-6 sm:p-7">
        <div className="flex items-start gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Sparkles className="h-5 w-5" aria-hidden="true" /></div><div><h2 className="font-semibold">Build an editable summary</h2><p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">AI will turn this note into separate ideas, definitions, questions, and next actions. You can rewrite, highlight, and annotate every line afterward.</p></div></div>
        {message && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{message}</p>}
        <Button className="mt-6" onClick={analyze} disabled={isPending}>{isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}{isPending ? 'Analyzing…' : 'Analyze with AI'}</Button>
        <p className="mt-3 text-xs text-muted-foreground">Uses the AI credential configured in Settings → AI. No configured credential means analysis will return an actionable error.</p>
      </section>
    )
  }

  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5"><div><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /><h2 className="font-semibold">Editable summary</h2></div><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Every line is yours to shape. Highlight the ideas you want to remember; add a comment when context matters.</p></div><Button variant="outline" size="sm" onClick={analyze} disabled={isPending}><RefreshCw className="h-4 w-4" aria-hidden="true" />Regenerate</Button></div>

      <div className="space-y-3">
        {lines.length === 0 && <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No summary lines yet. Add one below.</p>}
        {lines.map((line, index) => (
          <div key={line.id} className={`rounded-lg border p-3 transition-colors sm:p-4 ${line.highlighted ? 'border-amber-400/60 bg-amber-300/15 dark:border-amber-300/40 dark:bg-amber-300/10' : 'border-border/80 bg-muted/10'}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="outline">{KIND_LABELS[line.kind]}</Badge>{line.sourceLine !== undefined && <span className="text-xs text-muted-foreground">from line {line.sourceLine + 1}</span>}<span className="ml-auto text-xs text-muted-foreground">{index + 1}/{lines.length}</span></div>
            <Textarea aria-label={`Summary line ${index + 1}`} value={line.text} onChange={(event) => updateLine(index, { text: event.target.value })} rows={2} className="min-h-14 resize-y border-0 bg-transparent px-0 py-1 leading-7 shadow-none focus-visible:ring-0" />
            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/70 pt-2"><button type="button" aria-pressed={line.highlighted} onClick={() => updateLine(index, { highlighted: !line.highlighted })} className={`inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-xs font-semibold transition-colors ${line.highlighted ? 'bg-amber-300/30 text-amber-900 dark:text-amber-100' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Highlighter className="h-3.5 w-3.5" aria-hidden="true" />{line.highlighted ? 'Highlighted' : 'Highlight'}</button><button type="button" aria-expanded={commentOpen === line.id} onClick={() => setCommentOpen(commentOpen === line.id ? null : line.id)} className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />{line.comment ? 'Edit comment' : 'Annotate'}</button><button type="button" aria-label={`Remove summary line ${index + 1}`} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} className="ml-auto inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Remove</button></div>
            {commentOpen === line.id && <div className="mt-3"><label htmlFor={`summary-comment-${line.id}`} className="mb-1.5 block text-xs font-semibold text-muted-foreground">Your comment</label><Textarea id={`summary-comment-${line.id}`} value={line.comment} onChange={(event) => updateLine(index, { comment: event.target.value })} placeholder="Why does this matter to me? What should I connect it to?" rows={2} maxLength={2000} /></div>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" size="sm" onClick={() => setLines((current) => [...current, { id: `line-${Date.now()}`, text: '', kind: 'insight', highlighted: false, comment: '' }])}><Plus className="h-4 w-4" aria-hidden="true" />Add summary line</Button><div className="flex items-center gap-3">{message && <span role="status" className="text-xs text-muted-foreground">{message}</span>}<Button type="button" onClick={save} disabled={isPending || lines.some((line) => !line.text.trim())}>{isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{isPending ? 'Saving…' : 'Save summary edits'}</Button></div></div>

      <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Key terms</p><div className="flex flex-wrap gap-2">{analysis.keyTerms.length > 0 ? analysis.keyTerms.map((term) => <Badge key={term} variant="secondary">{term}</Badge>) : <span className="text-sm text-muted-foreground">None extracted</span>}</div></div><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Follow-ups</p>{analysis.followUps.length > 0 ? <ul className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">{analysis.followUps.map((followUp) => <li key={followUp} className="flex gap-2"><span className="text-primary">→</span>{followUp}</li>)}</ul> : <span className="text-sm text-muted-foreground">None suggested</span>}</div></div>
    </section>
  )
}
