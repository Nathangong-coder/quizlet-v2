'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  listConceptTree,
  createConcept,
  reparentConcept,
  renameConcept,
  mergeConcepts,
  deleteConcept,
  setNodeStyle,
  type ConceptTreeNode,
  type UnplacedConcept,
} from '@/actions/klt-tree'
import { suggestSkeleton, applySkeleton } from '@/actions/klt-seed'
import { listPresets, applyPreset, savePresetFromSet, type KltPresetSummary } from '@/actions/klt-presets'
import { evaluateDrop, type DragSource } from '@/lib/klt/drag'
import { ConceptCanvas } from '@/components/klt/ConceptCanvas'
import { ConceptSidePanel } from '@/components/klt/ConceptSidePanel'
import { NodeInspector } from '@/components/klt/NodeInspector'

/**
 * Which nodes the filter box keeps: every node whose name matches, PLUS every
 * ancestor of a match, so a matched leaf still has a visible chain above it.
 * Returns null for an empty filter — "no restriction", which is a different
 * thing from an empty set ("hide everything").
 */
function computeFilterVisible(nodes: ConceptTreeNode[], filter: string): Set<string> | null {
  const q = filter.trim().toLowerCase()
  if (!q) return null
  const visible = new Set<string>()
  for (const n of nodes) {
    if (!n.name.toLowerCase().includes(q)) continue
    visible.add(n.kltId)
    for (const ancestorKltId of n.ancestorIds) visible.add(ancestorKltId)
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

/**
 * A write held back for confirmation.
 *
 * Only two things ever reach here: a move that carries OTHER nodes with it,
 * and a merge (which deletes the source outright). A move of one node applies
 * immediately — confirming a single-node drag makes drag-and-drop feel broken,
 * while the blast-radius warning still fires exactly where it earns its keep.
 */
type Pending =
  | {
      kind: 'move'
      source: DragSource
      newParentKltId: string | null
      newParentName: string
      movedCount: number
      /** A move of a concept that has no node yet is a placement, not a move. */
      isPlacement: boolean
    }
  | { kind: 'merge'; sourceKltId: string; sourceName: string; targetKltId: string; targetName: string }

interface ConceptTreeProps {
  setId: string
  /** Pre-fills the AI seeding subject, so the owner rarely has to type it. */
  setTitle: string
  /**
   * Whether the viewer reached this set through the admin role rather than
   * by owning it. Gates ONE control — saving this set's structure as a
   * shared preset, which is an operator capability (spec §3b). Defaults to
   * false so an omitted prop never accidentally grants it.
   */
  isAdmin?: boolean
  /**
   * Whether this viewer may CHANGE the structure. False for someone who
   * reached a link-shared set they do not own — they get the canvas, the
   * lists, and the linked-cards panel, and no control that writes.
   *
   * Defaults to false so an omitted prop never accidentally grants editing,
   * the same posture as `isAdmin`. It is a rendering decision only: every
   * action re-checks `requireSetKltAccess` on the server, so a viewer who
   * forced a control into existence would still be refused.
   */
  canEdit?: boolean
}

/**
 * ONE set's concept tree, as a canvas.
 *
 * Renders from both `/sets/[id]/concepts` (the owner) and the admin picker at
 * `/concepts` — one editor, two ways in. Every write is scoped to `setId` and
 * gated server-side by `requireSetKltAccess`; this component does not re-check
 * access, it assumes the route that rendered it already 404'd a stranger.
 */
export function ConceptTree({ setId, setTitle, isAdmin = false, canEdit = false }: ConceptTreeProps) {
  const [nodes, setNodes] = useState<ConceptTreeNode[] | null>(null)
  const [unplaced, setUnplaced] = useState<UnplacedConcept[]>([])

  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selectedKltId, setSelectedKltId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<DragSource | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [placing, setPlacing] = useState<Set<string>>(new Set())

  const [addRootName, setAddRootName] = useState('')
  const [addingRoot, setAddingRoot] = useState(false)

  const [subject, setSubject] = useState(setTitle)
  const [suggesting, setSuggesting] = useState(false)
  const [skeleton, setSkeleton] = useState<string[][] | null>(null)
  const [applying, setApplying] = useState(false)

  const [presets, setPresets] = useState<KltPresetSummary[] | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [applyingPreset, setApplyingPreset] = useState(false)
  const [savePresetName, setSavePresetName] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)

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

  // `listPresets` is on the ownership gate, so a read-only viewer calling it
  // gets a not-found and a toast that tells them nothing. Skipped entirely.
  const loadPresets = useCallback(() => {
    if (!canEdit) return Promise.resolve()
    return listPresets(setId).then((res) => {
      if (!res.success) {
        toast.error(res.error || 'Failed to load presets')
        return
      }
      setPresets(res.data)
    })
  }, [setId, canEdit])

  useEffect(() => {
    loadPresets()
  }, [loadPresets])

  const allNodes = useMemo(() => nodes ?? [], [nodes])
  const byKltId = useMemo(() => new Map(allNodes.map((n) => [n.kltId, n])), [allNodes])
  const selected = selectedKltId ? byKltId.get(selectedKltId) ?? null : null

  const visible = useMemo(() => {
    const filterVisible = computeFilterVisible(allNodes, filter)
    return allNodes.filter((n) => {
      if (filterVisible) return filterVisible.has(n.kltId)
      return !n.ancestorIds.some((a) => collapsed.has(a))
    })
  }, [allNodes, filter, collapsed])

  function toggleCollapse(kltId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(kltId)) next.delete(kltId)
      else next.add(kltId)
      return next
    })
  }

  /** A move of one node, undoable straight from the toast. */
  async function commitMove(source: DragSource, newParentKltId: string | null, previousParentKltId: string | null) {
    const res = await reparentConcept(setId, source.kltId, newParentKltId)
    if (!res.success) {
      toast.error(res.error || 'Failed to move concept')
      return
    }
    toast.success(`Moved “${source.name}”`, {
      action: {
        label: 'Undo',
        onClick: () => {
          reparentConcept(setId, source.kltId, previousParentKltId).then((undo) => {
            if (!undo.success) toast.error(undo.error || 'Failed to undo')
            return load()
          })
        },
      },
    })
    await load()
  }

  /** Give an unplaced concept its first home. Undo deletes the fresh node. */
  async function commitPlacement(source: DragSource, parentKltId: string | null) {
    setPlacing((prev) => new Set(prev).add(source.kltId))
    const res = await createConcept(setId, source.name, parentKltId)
    setPlacing((prev) => {
      const next = new Set(prev)
      next.delete(source.kltId)
      return next
    })
    if (!res.success) {
      toast.error(res.error || 'Failed to place concept')
      return
    }
    const newKltId = res.data.kltId
    toast.success(`Placed “${source.name}”`, {
      action: {
        label: 'Undo',
        onClick: () => {
          // Safe: the node was just created, so it cannot have children yet,
          // and `deleteConcept` removes only THIS set's placement — the
          // concept and every key point citing it are untouched.
          deleteConcept(setId, newKltId).then((undo) => {
            if (!undo.success) toast.error(undo.error || 'Failed to undo')
            return load()
          })
        },
      },
    })
    await load()
  }

  /**
   * One decision point for every re-parent, however it was triggered — a drag
   * onto a node, a drop on the empty canvas, the inspector's parent select, or
   * the side panel's Place button. They all ask `evaluateDrop`, so they all
   * refuse the same things and confirm at the same threshold.
   */
  async function requestMove(source: DragSource, targetKltId: string | null) {
    const verdict = evaluateDrop(source.kltId, targetKltId, allNodes)
    if (!verdict.ok) {
      toast.error(verdict.reason)
      return
    }
    const isPlacement = verdict.kind === 'place'
    if (verdict.needsConfirm) {
      setPending({
        kind: 'move',
        source,
        newParentKltId: targetKltId,
        newParentName: targetKltId ? byKltId.get(targetKltId)?.name ?? targetKltId : '(root)',
        movedCount: verdict.movedCount,
        isPlacement,
      })
      return
    }
    if (isPlacement) await commitPlacement(source, targetKltId)
    else await commitMove(source, targetKltId, byKltId.get(source.kltId)?.parentKltId ?? null)
  }

  async function confirmPending() {
    if (!pending) return
    const p = pending
    setPending(null)
    if (p.kind === 'move') {
      if (p.isPlacement) await commitPlacement(p.source, p.newParentKltId)
      else
        await commitMove(
          p.source,
          p.newParentKltId,
          byKltId.get(p.source.kltId)?.parentKltId ?? null,
        )
      return
    }
    const res = await mergeConcepts(setId, p.sourceKltId, p.targetKltId)
    if (!res.success) {
      toast.error(res.error || 'Failed to merge concepts')
      return
    }
    if (selectedKltId === p.sourceKltId) setSelectedKltId(null)
    toast.success(`Merged “${p.sourceName}”`)
    await load()
  }

  async function handleRename(node: ConceptTreeNode, name: string) {
    if (!name || name === node.name) return
    const res = await renameConcept(setId, node.kltId, name)
    if (!res.success) {
      toast.error(res.error || 'Failed to rename concept')
      return
    }
    toast.success('Renamed')
    await load()
  }

  async function handleAddChild(node: ConceptTreeNode, name: string) {
    const res = await createConcept(setId, name, node.kltId)
    if (!res.success) {
      toast.error(res.error || 'Failed to add concept')
      return
    }
    toast.success(`Added “${name}” under “${node.name}”`)
    await load()
  }

  async function handleDelete(node: ConceptTreeNode) {
    const res = await deleteConcept(setId, node.kltId)
    if (!res.success) {
      toast.error(res.error || 'Failed to delete concept')
      return
    }
    if (selectedKltId === node.kltId) setSelectedKltId(null)
    toast.success('Deleted')
    await load()
  }

  async function handleStyle(node: ConceptTreeNode, style: { color?: string | null; icon?: string | null }) {
    // Optimistic: a colour swatch that waits for a round trip feels broken,
    // and the failure path below puts the real values back.
    setNodes((prev) =>
      prev ? prev.map((n) => (n.kltId === node.kltId ? { ...n, ...style } : n)) : prev,
    )
    const res = await setNodeStyle(setId, node.kltId, style)
    if (!res.success) {
      toast.error(res.error || 'Failed to update appearance')
      await load()
    }
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
    // WRITES NOTHING — the whole point of a preview. Discarding clears local
    // state; the server was never asked to apply anything.
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

  // Genuinely no structure: either no concepts at all, or the cards produced
  // concepts but none has ever been placed. Both are `nodes.length === 0`
  // (`nodes` only ever holds PLACED rows); only the copy differs, so nobody is
  // told "no concepts" while concepts plainly exist, just unorganised.
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

  // Applying is never automatic — it fires only when the owner picks a preset
  // and clicks Apply (Decision 7), the same posture as the AI preview above.
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Concept tree — {setTitle}</CardTitle>
          <CardDescription>
            {canEdit ? (
              <>
                Structural edits here — moving, merging, or deleting a concept — affect only{' '}
                <strong>{setTitle}</strong>, never any other set. Concept NAMES, though, are
                shared vocabulary across every set that uses them: renaming one used elsewhere is
                refused unless you&rsquo;re an operator, so you can&rsquo;t rename a label out
                from under another learner.
              </>
            ) : (
              <>
                How <strong>{setTitle}</strong> is organized. You can explore the tree and see
                what each concept covers, but only the set&rsquo;s owner can change it.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nodes === null && <p className="text-sm text-muted-foreground">Loading…</p>}

          {showEmptyPanel && !canEdit && (
            <div className="rounded-lg border border-dashed p-4 space-y-2">
              <p className="text-sm font-medium">
                {unplaced.length > 0 ? 'No structure yet' : 'No concepts yet'}
              </p>
              <p className="text-sm text-muted-foreground">
                {unplaced.length > 0
                  ? `This set’s cards cover ${unplaced.length} concept${unplaced.length === 1 ? '' : 's'}, but the owner hasn’t organised them into a tree yet.`
                  : 'The owner hasn’t added any concepts to this set yet.'}
              </p>
            </div>
          )}

          {showEmptyPanel && canEdit && (
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
          )}

          {nodes !== null && !showEmptyPanel && (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <ConceptSidePanel
                unplaced={unplaced}
                nodes={allNodes}
                selected={selected}
                canEdit={canEdit}
                filter={filter}
                onFilterChange={setFilter}
                onDragStart={setDragging}
                onDragEnd={() => setDragging(null)}
                onSelect={setSelectedKltId}
                onPlace={(concept) => requestMove(concept, selectedKltId)}
                placing={placing}
              />

              <div className="min-w-0 flex-1 space-y-3">
                {canEdit && addRootForm}

                <div className="relative">
                  <ConceptCanvas
                    visible={visible}
                    allNodes={allNodes}
                    collapsed={collapsed}
                    selectedKltId={selectedKltId}
                    canEdit={canEdit}
                    dragging={dragging}
                    onSelect={setSelectedKltId}
                    onToggleCollapse={toggleCollapse}
                    onDragStart={setDragging}
                    onDragEnd={() => setDragging(null)}
                    onDrop={(targetKltId) => {
                      const source = dragging
                      setDragging(null)
                      if (source) requestMove(source, targetKltId)
                    }}
                  />

                  {selected && (
                    <NodeInspector
                      key={selected.kltId}
                      node={selected}
                      allNodes={allNodes}
                      setId={setId}
                      canEdit={canEdit}
                      onClose={() => setSelectedKltId(null)}
                      onRename={handleRename}
                      onMove={(node, newParentKltId) =>
                        requestMove({ kltId: node.kltId, name: node.name }, newParentKltId)
                      }
                      onAddChild={handleAddChild}
                      onMerge={(node, targetKltId) =>
                        setPending({
                          kind: 'merge',
                          sourceKltId: node.kltId,
                          sourceName: node.name,
                          targetKltId,
                          targetName: byKltId.get(targetKltId)?.name ?? targetKltId,
                        })
                      }
                      onDelete={handleDelete}
                      onStyle={handleStyle}
                    />
                  )}

                  {pending && (
                    <div className="absolute inset-x-0 top-3 z-30 mx-auto w-[min(28rem,calc(100%-1.5rem))] rounded-lg border bg-card p-3 shadow-lg">
                      {pending.kind === 'move' ? (
                        <p className="text-sm">
                          Move &ldquo;{pending.source.name}&rdquo; under &ldquo;
                          {pending.newParentName}&rdquo;? This moves {pending.movedCount} concept
                          {pending.movedCount === 1 ? '' : 's'}.
                        </p>
                      ) : (
                        <p className="text-sm">
                          Merge &ldquo;{pending.sourceName}&rdquo; into &ldquo;{pending.targetName}
                          &rdquo;? This deletes &ldquo;{pending.sourceName}&rdquo;.
                        </p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={pending.kind === 'merge' ? 'destructive' : 'default'}
                          onClick={confirmPending}
                        >
                          {pending.kind === 'merge' ? 'Confirm merge' : 'Confirm move'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setPending(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!showEmptyPanel && canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Suggest a starting structure</CardTitle>
            <CardDescription>
              Proposes the top 2-3 rungs of a subject&rsquo;s hierarchy using this set&rsquo;s own
              extracted concepts as evidence. Nothing is written until you review the preview and
              click Apply.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {aiSuggestSection}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Or apply a saved preset</p>
              {presetSection}
            </div>
          </CardContent>
        </Card>
      )}

      {!showEmptyPanel && canEdit && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Presets</CardTitle>
            <CardDescription>
              Capture this set&rsquo;s current structure as a reusable preset — other owners can
              apply it to seed a new set&rsquo;s tree. Only visible to operators.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Save this set&rsquo;s structure as a preset
              </p>
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
          </CardContent>
        </Card>
      )}
    </div>
  )
}
