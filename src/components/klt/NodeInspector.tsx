'use client'

import { createElement, useState } from 'react'
import { X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  NODE_COLORS,
  NODE_COLOR_KEYS,
  NODE_ICONS,
  NODE_ICON_KEYS,
  iconFor,
} from '@/components/klt/node-style'
import { ConceptCards } from '@/components/klt/ConceptCards'
import type { ConceptTreeNode } from '@/actions/klt-tree'

const ROOT_VALUE = ''

interface NodeInspectorProps {
  node: ConceptTreeNode
  /** Every node in the set — the move/merge targets are drawn from this. */
  allNodes: ConceptTreeNode[]
  /** Scopes the linked-cards fetch, and the links out to each card. */
  setId: string
  /**
   * False for someone viewing a set they were shared. Hides every control
   * that writes, leaving the panel as a details view. A UI decision only —
   * each action re-checks `requireSetKltAccess` server-side, so flipping this
   * in a devtools console buys nothing.
   */
  canEdit: boolean
  onClose: () => void
  onRename: (node: ConceptTreeNode, name: string) => void
  onMove: (node: ConceptTreeNode, newParentKltId: string | null) => void
  onAddChild: (node: ConceptTreeNode, name: string) => void
  onMerge: (node: ConceptTreeNode, targetKltId: string) => void
  onDelete: (node: ConceptTreeNode) => void
  onStyle: (node: ConceptTreeNode, style: { color?: string | null; icon?: string | null }) => void
}

/**
 * Everything about ONE node, in one place: what is filed under it, and —
 * for someone who may edit — every control that changes it.
 *
 * This is the half of the redesign that removes the complexity rather than
 * moving it: the old editor put four selects and a text input on every row, so
 * a twenty-concept tree rendered a hundred controls at once. Here the controls
 * exist once and address whichever node is selected.
 *
 * The parent mounts this with `key={node.kltId}` so the drafts below reset
 * when the selection changes — otherwise a half-typed rename would follow you
 * onto the next node and get applied to it. The same remount is what refetches
 * the linked cards.
 */
export function NodeInspector({
  node,
  allNodes,
  setId,
  canEdit,
  onClose,
  onRename,
  onMove,
  onAddChild,
  onMerge,
  onDelete,
  onStyle,
}: NodeInspectorProps) {
  const [nameDraft, setNameDraft] = useState(node.name)
  const [childDraft, setChildDraft] = useState('')
  const [showIcons, setShowIcons] = useState(false)

  // Neither itself nor anything beneath it: either would make the node its own
  // ancestor. Detected through `ancestorIds`, which holds `kltId`s.
  const parent = node.parentKltId
    ? allNodes.find((n) => n.kltId === node.parentKltId) ?? null
    : null

  const candidates = allNodes
    .filter((n) => n.kltId !== node.kltId && !n.ancestorIds.includes(node.kltId))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="absolute right-3 top-16 bottom-3 z-20 flex w-80 flex-col overflow-hidden rounded-xl border bg-card shadow-lg">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        {/* `createElement`, not `const Icon = iconFor(...)` at the top of the
            component: the compiler lint reads a capitalised binding assigned
            from a call as a component DECLARED during render (which resets
            its state every render). `iconFor` only looks an existing
            component up, so this is the honest spelling of the same thing. */}
        {createElement(iconFor(node.icon), {
          className: 'size-4 shrink-0 text-muted-foreground',
          'aria-hidden': true,
        })}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{node.name}</h3>
        <Button type="button" variant="ghost" size="icon" aria-label="Close inspector" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        {!canEdit && (
          <p className="text-[11px] text-muted-foreground">
            {parent ? (
              <>
                Under <strong>{parent.name}</strong>
              </>
            ) : (
              'A top-level concept'
            )}
            {node.childCount > 0 &&
              ` · ${node.childCount} child concept${node.childCount === 1 ? '' : 's'}`}
          </p>
        )}

        <ConceptCards setId={setId} kltId={node.kltId} />

        {canEdit && (
          <>
        <section className="space-y-1.5">
          <label htmlFor="node-name" className="text-xs font-medium text-muted-foreground">
            Name
          </label>
          <div className="flex gap-2">
            <Input
              id="node-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="h-8"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!nameDraft.trim() || nameDraft.trim() === node.name}
              onClick={() => onRename(node, nameDraft.trim())}
            >
              Rename
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Concept names are shared across sets — renaming one another set also uses is refused.
          </p>
        </section>

        <section className="space-y-1.5">
          <label htmlFor="node-parent" className="text-xs font-medium text-muted-foreground">
            Parent
          </label>
          <select
            id="node-parent"
            aria-label={`Move ${node.name} under`}
            value={node.parentKltId ?? ROOT_VALUE}
            onChange={(e) => onMove(node, e.target.value === ROOT_VALUE ? null : e.target.value)}
            className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
          >
            <option value={ROOT_VALUE}>(make a root)</option>
            {candidates.map((c) => (
              <option key={c.kltId} value={c.kltId}>
                {c.name}
              </option>
            ))}
          </select>
        </section>

        <section className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Colour</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-label="Inherit colour from parent"
              aria-pressed={!node.color}
              onClick={() => onStyle(node, { color: null })}
              className={`flex h-7 items-center rounded-md border px-2 text-[11px] ${
                !node.color ? 'ring-2 ring-primary' : ''
              }`}
            >
              Inherit
            </button>
            {NODE_COLOR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={NODE_COLORS[key].label}
                aria-pressed={node.color === key}
                onClick={() => onStyle(node, { color: key })}
                className={`flex size-7 items-center justify-center rounded-md ${NODE_COLORS[key].bar} ${
                  node.color === key ? 'ring-2 ring-primary ring-offset-1 ring-offset-card' : ''
                }`}
              >
                {node.color === key && <Check className="size-3.5 text-white" />}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Children inherit this unless they set their own.
          </p>
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Icon</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setShowIcons((v) => !v)}
            >
              {showIcons ? 'Hide' : 'Change'}
            </Button>
          </div>
          {showIcons && (
            <div className="grid grid-cols-8 gap-1">
              {NODE_ICON_KEYS.map((key) => {
                const { label, Icon } = NODE_ICONS[key]
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={label}
                    aria-pressed={node.icon === key}
                    onClick={() => onStyle(node, { icon: key })}
                    className={`flex size-7 items-center justify-center rounded-md border hover:bg-accent ${
                      node.icon === key ? 'ring-2 ring-primary' : ''
                    }`}
                  >
                    <Icon className="size-3.5" />
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="space-y-1.5">
          <label htmlFor="node-add-child" className="text-xs font-medium text-muted-foreground">
            Add a child concept
          </label>
          <div className="flex gap-2">
            <Input
              id="node-add-child"
              aria-label={`New concept under ${node.name}`}
              placeholder="e.g. quick ratio"
              value={childDraft}
              onChange={(e) => setChildDraft(e.target.value)}
              className="h-8"
            />
            <Button
              type="button"
              size="sm"
              disabled={!childDraft.trim()}
              onClick={() => {
                onAddChild(node, childDraft.trim())
                setChildDraft('')
              }}
            >
              Add
            </Button>
          </div>
        </section>

        <section className="space-y-1.5">
          <label htmlFor="node-merge" className="text-xs font-medium text-muted-foreground">
            Merge into
          </label>
          <select
            id="node-merge"
            aria-label={`Merge ${node.name} into`}
            value=""
            onChange={(e) => e.target.value && onMerge(node, e.target.value)}
            className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="">(choose a target)</option>
            {candidates.map((c) => (
              <option key={c.kltId} value={c.kltId}>
                {c.name}
              </option>
            ))}
          </select>
        </section>
          </>
        )}
      </div>

      {canEdit && (
      <footer className="border-t p-3">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="w-full"
          disabled={node.childCount > 0}
          onClick={() => onDelete(node)}
        >
          Delete concept
        </Button>
        {node.childCount > 0 && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Has {node.childCount} child{node.childCount === 1 ? '' : 'ren'} — move or delete them first.
          </p>
        )}
      </footer>
      )}
    </div>
  )
}
