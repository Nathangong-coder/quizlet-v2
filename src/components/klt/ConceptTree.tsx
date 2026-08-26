'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  listConceptTree,
  reparentConcept,
  renameConcept,
  mergeConcepts,
  deleteConcept,
  type ConceptTreeNode,
} from '@/actions/klt-tree'
import { suggestSkeleton, applySkeleton } from '@/actions/klt-seed'

/** Sentinel value the "Move under…"/"Merge into…" selects use for "no parent". */
const ROOT_VALUE = ''

/**
 * A stable depth-first ordering of the whole tree: parents before children,
 * siblings sorted by name. Mirrors `renderTreeForPrompt`'s walk exactly, so
 * the editor and the AI prompt agree on what "the tree, in order" means.
 */
function orderNodes(nodes: ConceptTreeNode[]): ConceptTreeNode[] {
  const byParent = new Map<string | null, ConceptTreeNode[]>()
  for (const n of nodes) {
    const list = byParent.get(n.parentKltId)
    if (list) list.push(n)
    else byParent.set(n.parentKltId, [n])
  }

  const out: ConceptTreeNode[] = []
  const walk = (parentId: string | null) => {
    const kids = [...(byParent.get(parentId) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    for (const k of kids) {
      out.push(k)
      walk(k.id)
    }
  }
  walk(null)
  return out
}

/**
 * Every node EXCEPT `node` itself and any descendant of `node` — offering
 * either would let a move/merge make a node its own ancestor. A descendant
 * is detected via `ancestorIds`, which every node already carries.
 */
function nonDescendants(node: ConceptTreeNode, all: ConceptTreeNode[]): ConceptTreeNode[] {
  return all
    .filter((n) => n.id !== node.id && !n.ancestorIds.includes(node.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

interface SkeletonNode {
  name: string
  children: SkeletonNode[]
}

/** Groups the AI's proposed paths by shared prefix, for an indented preview. */
function buildSkeletonPreview(paths: string[][]): SkeletonNode[] {
  const roots: SkeletonNode[] = []
  for (const path of paths) {
    let siblings = roots
    for (const name of path) {
      let existing = siblings.find((n) => n.name === name)
      if (!existing) {
        existing = { name, children: [] }
        siblings.push(existing)
      }
      siblings = existing.children
    }
  }
  return roots
}

function SkeletonPreviewList({ nodes, depth = 0 }: { nodes: SkeletonNode[]; depth?: number }) {
  return (
    <ul className="space-y-1">
      {nodes.map((n) => (
        <li key={`${depth}-${n.name}`} style={{ paddingLeft: `${depth * 1.25}rem` }} className="text-sm">
          {n.name}
          {n.children.length > 0 && <SkeletonPreviewList nodes={n.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  )
}

/**
 * The global concept-tree editor (spec §5). Every write here is gated
 * server-side by `isKltEditor` — this component assumes it is only ever
 * reached through `/concepts`, which 404s a non-editor before this ever
 * renders.
 *
 * "Move under…" is a `<select>`, not drag-and-drop (spec §5.1 mentions
 * drag): a select is keyboard-accessible, testable, and functionally
 * equivalent for a tree this shallow.
 */
export function ConceptTree() {
  const [nodes, setNodes] = useState<ConceptTreeNode[] | null>(null)
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({})
  const [mergeDraft, setMergeDraft] = useState<Record<string, string>>({})
  const [confirmMerge, setConfirmMerge] = useState<{ sourceId: string; targetId: string } | null>(null)

  const [subject, setSubject] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [skeleton, setSkeleton] = useState<string[][] | null>(null)
  const [applying, setApplying] = useState(false)

  // `.then(callback)`, not `async`/`await`: `react-hooks/set-state-in-effect`
  // flags a setState reachable from an async function called directly in an
  // effect body, even though the state write happens after the await — the
  // same "callback invoked later" shape `LearnerDashboardContent` uses.
  const load = useCallback(() => {
    return listConceptTree().then((res) => {
      // Early return, not `if (res.success && ...)`: ActionResult is a
      // discriminated union, so `res.error` only narrows inside the failure arm.
      if (!res.success) {
        toast.error(res.error || 'Failed to load the concept tree')
        return
      }
      setNodes(res.data)
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleMove(node: ConceptTreeNode, value: string) {
    const newParentId = value === ROOT_VALUE ? null : value
    if (newParentId === node.parentKltId) return
    const res = await reparentConcept(node.id, newParentId)
    if (!res.success) {
      toast.error(res.error || 'Failed to move concept')
      return
    }
    toast.success(`Moved “${node.name}”`)
    await load()
  }

  async function handleRename(node: ConceptTreeNode) {
    const value = (renameDrafts[node.id] ?? node.name).trim()
    if (!value || value === node.name) return
    const res = await renameConcept(node.id, value)
    if (!res.success) {
      toast.error(res.error || 'Failed to rename concept')
      return
    }
    toast.success('Renamed')
    setRenameDrafts((prev) => {
      const next = { ...prev }
      delete next[node.id]
      return next
    })
    await load()
  }

  function handleMergeSelect(node: ConceptTreeNode, value: string) {
    setMergeDraft((prev) => ({ ...prev, [node.id]: value }))
    if (value) setConfirmMerge({ sourceId: node.id, targetId: value })
  }

  function cancelMerge() {
    if (confirmMerge) {
      setMergeDraft((prev) => ({ ...prev, [confirmMerge.sourceId]: '' }))
    }
    setConfirmMerge(null)
  }

  async function confirmMergeNow() {
    if (!confirmMerge) return
    const { sourceId, targetId } = confirmMerge
    const res = await mergeConcepts(sourceId, targetId)
    setConfirmMerge(null)
    setMergeDraft((prev) => ({ ...prev, [sourceId]: '' }))
    if (!res.success) {
      toast.error(res.error || 'Failed to merge concepts')
      return
    }
    toast.success('Merged')
    await load()
  }

  async function handleDelete(node: ConceptTreeNode) {
    const res = await deleteConcept(node.id)
    if (!res.success) {
      toast.error(res.error || 'Failed to delete concept')
      return
    }
    toast.success('Deleted')
    await load()
  }

  async function handleSuggest() {
    const trimmed = subject.trim()
    if (!trimmed) {
      toast.error('Enter a subject first')
      return
    }
    setSuggesting(true)
    const res = await suggestSkeleton(trimmed)
    setSuggesting(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to suggest a structure')
      return
    }
    setSkeleton(res.data.paths)
  }

  function handleDiscard() {
    // WRITES NOTHING — the whole point of a preview. Discarding just clears
    // local state; the server was never asked to apply anything.
    setSkeleton(null)
  }

  async function handleApply() {
    if (!skeleton) return
    setApplying(true)
    const res = await applySkeleton(skeleton)
    setApplying(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to apply the suggested structure')
      return
    }
    const { created, skipped } = res.data
    // Never silent about a refused path — the whole point of the folded-in
    // fix: a caller that only sees "created" never learns some rungs were
    // refused.
    toast.success(skipped > 0 ? `Applied ${created}, skipped ${skipped}` : `Applied ${created}`)
    setSkeleton(null)
    await load()
  }

  const ordered = nodes ? orderNodes(nodes) : []

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Concept tree</CardTitle>
          <CardDescription>
            This tree is GLOBAL — shared across every account. Moving, renaming, merging, or
            deleting a concept here affects every learner&rsquo;s topic mastery, not just yours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {nodes === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {nodes !== null && ordered.length === 0 && (
            <p className="text-sm text-muted-foreground">No concepts yet.</p>
          )}
          {ordered.map((node) => {
            const candidates = nonDescendants(node, nodes ?? [])
            const mergeValue = mergeDraft[node.id] ?? ''
            return (
              <div
                key={node.id}
                data-node-id={node.id}
                data-depth={node.depth}
                style={{ paddingLeft: `${node.depth * 1.25}rem` }}
                className="rounded-lg border p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="font-medium">{node.name}</p>
                  <Badge variant="outline">{node.linkCount} link{node.linkCount === 1 ? '' : 's'}</Badge>
                  <Badge variant="outline">
                    {node.childCount} child{node.childCount === 1 ? '' : 'ren'}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Move under
                    <select
                      aria-label={`Move ${node.name} under`}
                      value={node.parentKltId ?? ROOT_VALUE}
                      onChange={(e) => handleMove(node, e.target.value)}
                      className="border rounded px-2 py-1 text-sm"
                    >
                      <option value={ROOT_VALUE}>(make a root)</option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <Input
                    aria-label={`Rename ${node.name}`}
                    value={renameDrafts[node.id] ?? node.name}
                    onChange={(e) =>
                      setRenameDrafts((prev) => ({ ...prev, [node.id]: e.target.value }))
                    }
                    className="w-40"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => handleRename(node)}>
                    Rename
                  </Button>

                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Merge into
                    <select
                      aria-label={`Merge ${node.name} into`}
                      value={mergeValue}
                      onChange={(e) => handleMergeSelect(node, e.target.value)}
                      className="border rounded px-2 py-1 text-sm"
                    >
                      <option value="">(choose a target)</option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={node.childCount > 0}
                    onClick={() => handleDelete(node)}
                  >
                    Delete
                  </Button>
                  {node.childCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Has {node.childCount} child{node.childCount === 1 ? '' : 'ren'} — move or delete
                      them first
                    </span>
                  )}
                </div>

                {/* Merge deletes the source node, so it never fires on the
                    select's onChange alone — a confirm step is required. */}
                {confirmMerge?.sourceId === node.id && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-2">
                    <p className="text-sm">
                      Merge &ldquo;{node.name}&rdquo; into &ldquo;
                      {nodes?.find((n) => n.id === confirmMerge.targetId)?.name ?? confirmMerge.targetId}
                      &rdquo;? This deletes &ldquo;{node.name}&rdquo;.
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" variant="destructive" size="sm" onClick={confirmMergeNow}>
                        Confirm merge
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={cancelMerge}>
                        Cancel merge
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suggest a starting structure</CardTitle>
          <CardDescription>
            Proposes the top 2-3 rungs of a subject&rsquo;s hierarchy using your extracted concepts
            as evidence. Nothing is written until you review the preview and click Apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Subject"
              placeholder="e.g. finance"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-56"
            />
            <Button type="button" variant="outline" size="sm" onClick={handleSuggest} disabled={suggesting}>
              {suggesting ? 'Suggesting…' : 'Suggest a starting structure'}
            </Button>
          </div>

          {skeleton && (
            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-sm text-muted-foreground">
                Preview — nothing has been written yet.
              </p>
              <SkeletonPreviewList nodes={buildSkeletonPreview(skeleton)} />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={handleApply} disabled={applying}>
                  {applying ? 'Applying…' : 'Apply'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleDiscard}>
                  Discard
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
