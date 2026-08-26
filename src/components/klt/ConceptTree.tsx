'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  listConceptTree,
  createConcept,
  reparentConcept,
  renameConcept,
  mergeConcepts,
  deleteConcept,
  type ConceptTreeNode,
  type UnplacedConcept,
} from '@/actions/klt-tree'
import { suggestSkeleton, applySkeleton } from '@/actions/klt-seed'
import { listPresets, applyPreset, savePresetFromSet, type KltPresetSummary } from '@/actions/klt-presets'
import { computeSubtreeUpdates } from '@/lib/klt/tree'

/** Sentinel value the "Move under…"/"Merge into…" selects use for "no parent". */
const ROOT_VALUE = ''

/**
 * A stable depth-first ordering of the whole tree: parents before children,
 * siblings sorted by name. Mirrors `renderTreeForPrompt`'s walk exactly, so
 * the editor and the AI prompt agree on what "the tree, in order" means.
 *
 * Keyed on `kltId` throughout — `parentKltId`/`ancestorIds` hold concept ids,
 * never the `SetKltNode` row id.
 */
function orderNodes(nodes: ConceptTreeNode[]): ConceptTreeNode[] {
  const byParent = new Map<string | null, ConceptTreeNode[]>()
  for (const n of nodes) {
    const list = byParent.get(n.parentKltId)
    if (list) list.push(n)
    else byParent.set(n.parentKltId, [n])
  }

  const out: ConceptTreeNode[] = []
  const walk = (parentKltId: string | null) => {
    const kids = [...(byParent.get(parentKltId) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    for (const k of kids) {
      out.push(k)
      walk(k.kltId)
    }
  }
  walk(null)
  return out
}

/**
 * Every node EXCEPT `node` itself and any descendant of `node` — offering
 * either would let a move/merge make a node its own ancestor. A descendant
 * is detected via `ancestorIds`, which holds `kltId`s.
 */
function nonDescendants(node: ConceptTreeNode, all: ConceptTreeNode[]): ConceptTreeNode[] {
  return all
    .filter((n) => n.kltId !== node.kltId && !n.ancestorIds.includes(node.kltId))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Is `node` hidden because some ancestor of it is collapsed?
 *
 * Walks the FULL `ancestorIds` chain (not just the direct parent) so
 * collapsing a grandparent hides everything beneath it, not just its
 * immediate children.
 */
function isHiddenByCollapse(
  node: ConceptTreeNode,
  collapsed: Set<string>,
  byKltId: Map<string, ConceptTreeNode>,
): boolean {
  for (const ancestorKltId of node.ancestorIds) {
    const ancestor = byKltId.get(ancestorKltId)
    if (ancestor && collapsed.has(ancestor.id)) return true
  }
  return false
}

/**
 * Which node ids the filter box keeps visible: every node whose name matches,
 * PLUS every ancestor of a match (for context — a matched leaf with no
 * visible parent chain is unreadable). Returns null for an empty filter,
 * meaning "the filter imposes no restriction" (distinct from an empty Set,
 * which would hide everything).
 */
function computeFilterVisibleIds(nodes: ConceptTreeNode[], filter: string): Set<string> | null {
  const q = filter.trim().toLowerCase()
  if (!q) return null
  const byKltId = new Map(nodes.map((n) => [n.kltId, n]))
  const visible = new Set<string>()
  for (const n of nodes) {
    if (!n.name.toLowerCase().includes(q)) continue
    visible.add(n.id)
    for (const ancestorKltId of n.ancestorIds) {
      const ancestor = byKltId.get(ancestorKltId)
      if (ancestor) visible.add(ancestor.id)
    }
  }
  return visible
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

/** A pending "move" awaiting confirmation, with its computed blast radius. */
interface MovePending {
  nodeId: string
  nodeKltId: string
  nodeName: string
  newParentKltId: string | null
  newParentName: string
  preview: { kind: 'count'; count: number } | { kind: 'error'; message: string }
}

/** A pending "merge" awaiting confirmation — merge deletes the source. */
interface MergePending {
  sourceId: string
  sourceKltId: string
  sourceName: string
  targetKltId: string
  targetName: string
}

interface ConceptTreeProps {
  setId: string
  /** Pre-fills the AI seeding subject, so the owner rarely has to type it. */
  setTitle: string
  /**
   * Whether the current viewer reached this set via the `KLT_EDITORS`
   * allowlist (`SetKltAccess.viaAllowlist`), not merely by owning it. Gates
   * ONE control — "save this set's structure as a preset" — since preset
   * AUTHORING is an operator capability (spec §3b), while applying one is
   * open to any owner. Defaults to `false` so an omitted prop never
   * accidentally grants it.
   */
  isAdmin?: boolean
}

/**
 * ONE set's concept-tree editor (spec Decision 3: this same component renders
 * both from `/sets/[id]/concepts`, reached by the set's owner, and from the
 * admin picker at `/concepts`, reached by a `KLT_EDITORS` operator via
 * `/sets/[id]/concepts` too — there is only one editor, not two).
 *
 * Every write below is scoped to `setId` and gated server-side by
 * `requireSetKltAccess`; this component does not re-check access, it assumes
 * whichever route rendered it already 404'd an unauthorized caller.
 */
export function ConceptTree({ setId, setTitle, isAdmin = false }: ConceptTreeProps) {
  const [nodes, setNodes] = useState<ConceptTreeNode[] | null>(null)
  const [unplaced, setUnplaced] = useState<UnplacedConcept[]>([])

  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({})
  const [movePending, setMovePending] = useState<MovePending | null>(null)
  const [mergeDraft, setMergeDraft] = useState<Record<string, string>>({})
  const [mergePending, setMergePending] = useState<MergePending | null>(null)

  const [addRootName, setAddRootName] = useState('')
  const [addingRoot, setAddingRoot] = useState(false)
  const [addChildOpen, setAddChildOpen] = useState<Set<string>>(new Set())
  const [addChildDrafts, setAddChildDrafts] = useState<Record<string, string>>({})

  const [subject, setSubject] = useState(setTitle)
  const [suggesting, setSuggesting] = useState(false)
  const [skeleton, setSkeleton] = useState<string[][] | null>(null)
  const [applying, setApplying] = useState(false)

  const [presets, setPresets] = useState<KltPresetSummary[] | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [applyingPreset, setApplyingPreset] = useState(false)
  const [savePresetName, setSavePresetName] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)

  const [placeDrafts, setPlaceDrafts] = useState<Record<string, string>>({})
  const [placing, setPlacing] = useState<Set<string>>(new Set())

  // `.then(callback)`, not `async`/`await`: `react-hooks/set-state-in-effect`
  // flags a setState reachable from an async function called directly in an
  // effect body, even though the state write happens after the await.
  const load = useCallback(() => {
    return listConceptTree(setId).then((res) => {
      if (!res.success) {
        toast.error(res.error || 'Failed to load the concept tree')
        return
      }
      setNodes(res.data.nodes)
      setUnplaced(res.data.unplaced)
    })
  }, [setId])

  useEffect(() => {
    load()
  }, [load])

  const loadPresets = useCallback(() => {
    return listPresets(setId).then((res) => {
      if (!res.success) {
        toast.error(res.error || 'Failed to load presets')
        return
      }
      setPresets(res.data)
    })
  }, [setId])

  useEffect(() => {
    loadPresets()
  }, [loadPresets])

  function toggleCollapse(nodeId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  function handleMoveSelect(node: ConceptTreeNode, value: string) {
    const newParentKltId = value === ROOT_VALUE ? null : value
    if (newParentKltId === node.parentKltId) return

    let preview: MovePending['preview']
    try {
      const updates = computeSubtreeUpdates(node.kltId, newParentKltId, nodes ?? [])
      preview = { kind: 'count', count: updates.length }
    } catch (err) {
      preview = { kind: 'error', message: err instanceof Error ? err.message : 'Unable to move concept' }
    }

    const newParentName =
      newParentKltId === null ? '(root)' : (nodes ?? []).find((n) => n.kltId === newParentKltId)?.name ?? newParentKltId

    setMovePending({ nodeId: node.id, nodeKltId: node.kltId, nodeName: node.name, newParentKltId, newParentName, preview })
  }

  function cancelMove() {
    setMovePending(null)
  }

  async function confirmMoveNow() {
    if (!movePending) return
    const res = await reparentConcept(setId, movePending.nodeKltId, movePending.newParentKltId)
    setMovePending(null)
    if (!res.success) {
      toast.error(res.error || 'Failed to move concept')
      return
    }
    toast.success(`Moved “${movePending.nodeName}”`)
    await load()
  }

  async function handleRename(node: ConceptTreeNode) {
    const value = (renameDrafts[node.id] ?? node.name).trim()
    if (!value || value === node.name) return
    const res = await renameConcept(setId, node.kltId, value)
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
    if (!value) return
    const target = (nodes ?? []).find((n) => n.kltId === value)
    setMergePending({
      sourceId: node.id,
      sourceKltId: node.kltId,
      sourceName: node.name,
      targetKltId: value,
      targetName: target?.name ?? value,
    })
  }

  function cancelMerge() {
    if (mergePending) {
      setMergeDraft((prev) => ({ ...prev, [mergePending.sourceId]: '' }))
    }
    setMergePending(null)
  }

  async function confirmMergeNow() {
    if (!mergePending) return
    const { sourceId, sourceKltId, targetKltId, sourceName } = mergePending
    const res = await mergeConcepts(setId, sourceKltId, targetKltId)
    setMergePending(null)
    setMergeDraft((prev) => ({ ...prev, [sourceId]: '' }))
    if (!res.success) {
      toast.error(res.error || 'Failed to merge concepts')
      return
    }
    toast.success(`Merged “${sourceName}”`)
    await load()
  }

  async function handleDelete(node: ConceptTreeNode) {
    const res = await deleteConcept(setId, node.kltId)
    if (!res.success) {
      toast.error(res.error || 'Failed to delete concept')
      return
    }
    toast.success('Deleted')
    await load()
  }

  async function handleAddRoot() {
    const value = addRootName.trim()
    if (!value) {
      toast.error('Enter a concept name')
      return
    }
    setAddingRoot(true)
    const res = await createConcept(setId, value, null)
    setAddingRoot(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to add concept')
      return
    }
    toast.success(`Added “${value}”`)
    setAddRootName('')
    await load()
  }

  function toggleAddChild(parentKltId: string) {
    setAddChildOpen((prev) => {
      const next = new Set(prev)
      if (next.has(parentKltId)) next.delete(parentKltId)
      else next.add(parentKltId)
      return next
    })
  }

  async function handleAddChild(parentKltId: string, parentName: string) {
    const value = (addChildDrafts[parentKltId] ?? '').trim()
    if (!value) {
      toast.error('Enter a concept name')
      return
    }
    const res = await createConcept(setId, value, parentKltId)
    if (!res.success) {
      toast.error(res.error || 'Failed to add concept')
      return
    }
    toast.success(`Added “${value}” under “${parentName}”`)
    setAddChildDrafts((prev) => ({ ...prev, [parentKltId]: '' }))
    setAddChildOpen((prev) => {
      const next = new Set(prev)
      next.delete(parentKltId)
      return next
    })
    await load()
  }

  async function handleSuggest() {
    const trimmed = subject.trim()
    if (!trimmed) {
      toast.error('Enter a subject first')
      return
    }
    setSuggesting(true)
    const res = await suggestSkeleton(setId, trimmed)
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
    const res = await applySkeleton(setId, skeleton)
    setApplying(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to apply the suggested structure')
      return
    }
    const { created, skipped } = res.data
    toast.success(skipped > 0 ? `Applied ${created}, skipped ${skipped}` : `Applied ${created}`)
    setSkeleton(null)
    await load()
  }

  async function handleApplyPreset() {
    if (!selectedPresetId) return
    setApplyingPreset(true)
    const res = await applyPreset(selectedPresetId, setId)
    setApplyingPreset(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to apply preset')
      return
    }
    const { created, skipped } = res.data
    toast.success(skipped > 0 ? `Applied ${created}, skipped ${skipped}` : `Applied ${created}`)
    await load()
  }

  async function handleSavePresetFromSet() {
    const value = savePresetName.trim()
    if (!value) {
      toast.error('Enter a preset name')
      return
    }
    setSavingPreset(true)
    const res = await savePresetFromSet(setId, value)
    setSavingPreset(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to save preset')
      return
    }
    const { skipped } = res.data
    toast.success(skipped > 0 ? `Saved “${value}” (skipped ${skipped})` : `Saved “${value}”`)
    setSavePresetName('')
    await loadPresets()
  }

  async function handlePlaceUnplaced(u: UnplacedConcept) {
    const value = placeDrafts[u.kltId] ?? ROOT_VALUE
    const parentKltId = value === ROOT_VALUE ? null : value
    setPlacing((prev) => new Set(prev).add(u.kltId))
    const res = await createConcept(setId, u.name, parentKltId)
    setPlacing((prev) => {
      const next = new Set(prev)
      next.delete(u.kltId)
      return next
    })
    if (!res.success) {
      toast.error(res.error || 'Failed to place concept')
      return
    }
    toast.success(`Placed “${u.name}”`)
    setPlaceDrafts((prev) => {
      const next = { ...prev }
      delete next[u.kltId]
      return next
    })
    await load()
  }

  const allNodes = nodes ?? []
  const byKltId = new Map(allNodes.map((n) => [n.kltId, n]))
  const filterVisible = computeFilterVisibleIds(allNodes, filter)
  const ordered = orderNodes(allNodes).filter((n) => {
    if (filterVisible) return filterVisible.has(n.id)
    return !isHiddenByCollapse(n, collapsed, byKltId)
  })
  const visibleUnplaced = unplaced.filter((u) =>
    filter.trim() ? u.name.toLowerCase().includes(filter.trim().toLowerCase()) : true,
  )

  // Shown once the set has genuinely no structure — either it has no
  // concepts at all yet, or its cards have already produced concepts
  // (`unplaced`) but none has ever been placed into a hierarchy. Both are
  // the SAME condition (`nodes.length === 0`, since `nodes` only ever holds
  // PLACED rows); only the copy differs, so the owner isn't told "no
  // concepts" when concepts clearly exist, just unorganized.
  const showEmptyPanel = nodes !== null && allNodes.length === 0

  const addRootForm = (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="New root concept name"
        placeholder="e.g. finance"
        value={addRootName}
        onChange={(e) => setAddRootName(e.target.value)}
        className="w-56"
      />
      <Button type="button" size="sm" onClick={handleAddRoot} disabled={addingRoot}>
        {addingRoot ? 'Adding…' : 'Add root concept'}
      </Button>
    </div>
  )

  const aiSuggestSection = (
    <div className="space-y-3">
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
          <p className="text-sm text-muted-foreground">Preview — nothing has been written yet.</p>
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
    </div>
  )

  // Task 5 fills in what was a dead seam here: a real preset picker, backed
  // by `listPresets`/`applyPreset` (spec §3b). Applying is never automatic —
  // it fires only when the owner picks a preset and clicks Apply (Decision
  // 7), same posture as the AI skeleton preview above.
  const presetSection = (
    <div className="space-y-1">
      {presets === null ? (
        <p className="text-xs text-muted-foreground">Loading presets…</p>
      ) : presets.length === 0 ? (
        <p className="text-xs text-muted-foreground">No presets saved yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Preset"
            value={selectedPresetId}
            onChange={(e) => setSelectedPresetId(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">(choose a preset)</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.pathCount})
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleApplyPreset}
            disabled={!selectedPresetId || applyingPreset}
          >
            {applyingPreset ? 'Applying…' : 'Apply preset'}
          </Button>
        </div>
      )}
    </div>
  )

  // Admin-only (spec §3b: authoring shared presets is an operator
  // capability). Captures THIS set's current structure as a new (or
  // replacement) preset — nothing else is written.
  const savePresetSection = isAdmin ? (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Save this set&rsquo;s structure as a preset</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Preset name"
          placeholder="e.g. finance skeleton"
          value={savePresetName}
          onChange={(e) => setSavePresetName(e.target.value)}
          className="w-56"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSavePresetFromSet}
          disabled={savingPreset || allNodes.length === 0}
        >
          {savingPreset ? 'Saving…' : 'Save as preset'}
        </Button>
      </div>
    </div>
  ) : null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Concept tree — {setTitle}</CardTitle>
          <CardDescription>
            Structural edits here — moving, merging, or deleting a concept — affect only{' '}
            <strong>{setTitle}</strong>, never any other set. Concept NAMES, though, are shared
            vocabulary across every set that uses them: renaming one used elsewhere is refused
            unless you&rsquo;re an operator, so you can&rsquo;t rename a label out from under
            another learner.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {nodes === null && <p className="text-sm text-muted-foreground">Loading…</p>}

          {nodes !== null && (allNodes.length > 0 || unplaced.length > 0) && (
            <Input
              aria-label="Filter concepts"
              placeholder="Filter concepts…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-64"
            />
          )}

          {/* Unplaced FIRST — this is what needs attention. */}
          {unplaced.length > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="font-medium text-sm">Unplaced concepts ({unplaced.length})</p>
              <p className="text-xs text-muted-foreground">
                Your cards cite these, but they have no place in the tree yet. AI placement will
                try them automatically, or place one yourself right here.
              </p>
              <ul className="space-y-1">
                {visibleUnplaced.map((u) => (
                  <li key={u.kltId} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{u.name}</span>
                    <Badge variant="outline">
                      {u.linkCount} link{u.linkCount === 1 ? '' : 's'}
                    </Badge>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Place under
                      <select
                        aria-label={`Place ${u.name} under`}
                        value={placeDrafts[u.kltId] ?? ROOT_VALUE}
                        onChange={(e) => setPlaceDrafts((prev) => ({ ...prev, [u.kltId]: e.target.value }))}
                        className="border rounded px-2 py-1 text-sm"
                      >
                        <option value={ROOT_VALUE}>(make a root)</option>
                        {[...allNodes]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((n) => (
                            <option key={n.kltId} value={n.kltId}>
                              {n.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handlePlaceUnplaced(u)}
                      disabled={placing.has(u.kltId)}
                    >
                      {placing.has(u.kltId) ? 'Placing…' : 'Place'}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showEmptyPanel ? (
            <div className="rounded-lg border border-dashed p-4 space-y-4">
              <p className="text-sm font-medium">
                {unplaced.length > 0 ? 'No structure yet' : 'No concepts yet'}
              </p>
              <p className="text-sm text-muted-foreground">
                Seed the top of this set&rsquo;s tree — type your own top-level concepts, generate
                a suggestion with AI, or apply a preset. Nothing here is written until you say so.
              </p>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Type your own</p>
                {addRootForm}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Generate with AI</p>
                {aiSuggestSection}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Apply a preset</p>
                {presetSection}
              </div>
            </div>
          ) : (
            nodes !== null && (
              <>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Add a root concept</p>
                  {addRootForm}
                </div>

                {ordered.map((node) => {
                  const candidates = nonDescendants(node, allNodes)
                  const mergeValue = mergeDraft[node.id] ?? ''
                  return (
                    <div
                      key={node.id}
                      data-node-id={node.id}
                      data-depth={node.depth}
                      style={{ marginLeft: `${node.depth * 1.25}rem` }}
                      className={node.depth > 0 ? 'border-l pl-3 space-y-2 py-1' : 'space-y-2 py-1'}
                    >
                      <div className="rounded-lg border p-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {node.childCount > 0 && (
                            <button
                              type="button"
                              aria-label={collapsed.has(node.id) ? `Expand ${node.name}` : `Collapse ${node.name}`}
                              onClick={() => toggleCollapse(node.id)}
                              className="text-xs text-muted-foreground w-4"
                            >
                              {collapsed.has(node.id) ? '▸' : '▾'}
                            </button>
                          )}
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
                              onChange={(e) => handleMoveSelect(node, e.target.value)}
                              className="border rounded px-2 py-1 text-sm"
                            >
                              <option value={ROOT_VALUE}>(make a root)</option>
                              {candidates.map((c) => (
                                <option key={c.kltId} value={c.kltId}>
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
                                <option key={c.kltId} value={c.kltId}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => toggleAddChild(node.kltId)}
                          >
                            Add child
                          </Button>

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
                              Has {node.childCount} child{node.childCount === 1 ? '' : 'ren'} — move or
                              delete them first
                            </span>
                          )}
                        </div>

                        {addChildOpen.has(node.kltId) && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              aria-label={`New concept under ${node.name}`}
                              placeholder="e.g. quick ratio"
                              value={addChildDrafts[node.kltId] ?? ''}
                              onChange={(e) =>
                                setAddChildDrafts((prev) => ({ ...prev, [node.kltId]: e.target.value }))
                              }
                              className="w-48"
                            />
                            <Button type="button" size="sm" onClick={() => handleAddChild(node.kltId, node.name)}>
                              Add
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => toggleAddChild(node.kltId)}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}

                        {/* Move is confirmed, not instant — the impact
                            preview is why: a select alone can't show "moves
                            N concepts" before it happens. */}
                        {movePending?.nodeId === node.id && (
                          <div className="rounded-md border p-2 space-y-2">
                            {movePending.preview.kind === 'count' ? (
                              <p className="text-sm">
                                Move &ldquo;{movePending.nodeName}&rdquo; under &ldquo;
                                {movePending.newParentName}&rdquo;? This moves{' '}
                                {movePending.preview.count} concept
                                {movePending.preview.count === 1 ? '' : 's'}.
                              </p>
                            ) : (
                              <p className="text-sm text-destructive">{movePending.preview.message}</p>
                            )}
                            <div className="flex gap-2">
                              {movePending.preview.kind === 'count' && (
                                <Button type="button" size="sm" onClick={confirmMoveNow}>
                                  Confirm move
                                </Button>
                              )}
                              <Button type="button" variant="outline" size="sm" onClick={cancelMove}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Merge deletes the source node, so it never fires
                            on the select's onChange alone. */}
                        {mergePending?.sourceId === node.id && (
                          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-2">
                            <p className="text-sm">
                              Merge &ldquo;{mergePending.sourceName}&rdquo; into &ldquo;
                              {mergePending.targetName}&rdquo;? This deletes &ldquo;
                              {mergePending.sourceName}&rdquo;.
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
                    </div>
                  )
                })}
              </>
            )
          )}
        </CardContent>
      </Card>

      {!showEmptyPanel && (
        <Card>
          <CardHeader>
            <CardTitle>Suggest a starting structure</CardTitle>
            <CardDescription>
              Proposes the top 2-3 rungs of a subject&rsquo;s hierarchy using this set&rsquo;s own
              extracted concepts as evidence. Nothing is written until you review the preview and
              click Apply.
            </CardDescription>
          </CardHeader>
          <CardContent>{aiSuggestSection}</CardContent>
        </Card>
      )}

      {!showEmptyPanel && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Presets</CardTitle>
            <CardDescription>
              Capture this set&rsquo;s current structure as a reusable preset — other owners can
              apply it to seed a new set&rsquo;s tree. Only visible to operators.
            </CardDescription>
          </CardHeader>
          <CardContent>{savePresetSection}</CardContent>
        </Card>
      )}
    </div>
  )
}
