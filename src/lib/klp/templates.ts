import type { QuestionType } from '@/lib/ai/schemas'

/**
 * SLOT TEMPLATES PER QUESTION TYPE (2026-09-19, owner: "something iterative
 * and not as free-flowing as a prompt").
 *
 * The author prompt already classifies the question (`QUESTION_TYPES`) and
 * describes each type's shape in prose. Prose is the weakest constraint we
 * have: every prompt version fixed one drift and opened the next. A template
 * makes the shape a FORM the writer fills — named slots, each with the kinds
 * of claim that belong in it and how many — and TypeScript checks the form,
 * not the prose. The rules, in the owner's words: "templates must be filled,
 * but can go over by like 2-3 KLPs (not a super strict template but generally
 * strict)".
 *
 *  - every slot with `min > 0` must be filled — an unfilled slot is a DEFECT
 *    (`slot_unfilled`), routed to revision, or to the owner when the card's
 *    definition gives nothing to fill it with;
 *  - a slot never holds more than `max`;
 *  - the whole set never exceeds the template's minimum size + OVERFLOW;
 *  - the RELATION RULES name the links the shape itself implies (a
 *    walkthrough's steps precede each other; a why's mechanism causes its
 *    consequence). They are added deterministically, provenance `template`,
 *    and are never a fabrication because they follow from slots the writer
 *    filled — not from an edge the relate call guessed.
 *
 * Nothing here calls a model. The template a card uses is chosen by the
 * writer's own `questionType`; the check is on what came back.
 */

export const TEMPLATE_OVERFLOW = 3

export type KlpKindName = 'definition' | 'mechanism' | 'causal' | 'condition' | 'quantitative' | 'contrast' | 'example'

export interface SlotSpec {
  id: string
  /** What the slot holds, for the writer and for the check. */
  text: string
  /** Kinds a point in this slot may carry; empty = any. */
  kinds: readonly KlpKindName[]
  min: number
  max: number
  /** A `framing` slot is the definitional anchor the template excludes from separation. */
  framing?: boolean
  /**
   * The slot's count is the LIST COUNT of the question or card ("what are 5
   * sources…"): `min` and `max` are replaced by that number when the caller
   * knows it. Only the enumerate template's `item` slot uses this.
   */
  countFromList?: boolean
}

export type RelationRule =
  /** Consecutive points in `slot` are linked `precedes`, in index order. */
  | { rule: 'chain'; slot: string; type: 'precedes' }
  /** Every point in `from` links to every point in `to` with `type`. */
  | { rule: 'each'; from: string; to: string; type: 'causes' | 'requires' | 'applies_within' | 'precedes' | 'confused_with' }

export interface QuestionTemplate {
  type: QuestionType
  slots: readonly SlotSpec[]
  relations: readonly RelationRule[]
}

const anyKind: readonly KlpKindName[] = []

export const QUESTION_TEMPLATES: Record<QuestionType, QuestionTemplate> = {
  define: {
    type: 'define',
    slots: [
      { id: 'definition', text: 'what the term is, in one sentence', kinds: ['definition'], min: 1, max: 1, framing: true },
      { id: 'purpose', text: 'what it is for / why it exists', kinds: ['causal', 'mechanism'], min: 1, max: 2 },
      { id: 'distinction', text: 'the one distinction or nuance a strong candidate adds', kinds: ['contrast', 'condition'], min: 1, max: 2 },
    ],
    relations: [{ rule: 'each', from: 'definition', to: 'purpose', type: 'precedes' }],
  },
  enumerate: {
    type: 'enumerate',
    slots: [
      { id: 'item', text: 'one item of the list the question asks for, at knowledge grain — exactly as many as the question or card lists', kinds: anyKind, min: 2, max: 7, countFromList: true },
      { id: 'mechanism', text: 'why an item works, attached to it', kinds: ['mechanism', 'causal'], min: 0, max: 4 },
    ],
    relations: [],
  },
  walkthrough: {
    type: 'walkthrough',
    slots: [
      { id: 'step', text: 'one step, in the order it happens', kinds: ['mechanism', 'causal', 'quantitative'], min: 3, max: 7 },
      { id: 'endpoint', text: 'where it ends up — the result the steps produce', kinds: ['causal', 'quantitative', 'contrast'], min: 1, max: 1 },
    ],
    relations: [{ rule: 'chain', slot: 'step', type: 'precedes' }],
  },
  why: {
    type: 'why',
    slots: [
      { id: 'claim', text: 'the claim the question asks about, stated', kinds: ['definition', 'causal', 'contrast'], min: 1, max: 1 },
      { id: 'mechanism', text: 'how it works — the mechanism that makes the claim true', kinds: ['mechanism', 'causal'], min: 1, max: 2 },
      { id: 'consequence', text: 'what follows — the point that lands the why', kinds: ['causal', 'quantitative', 'contrast'], min: 1, max: 1 },
      { id: 'condition', text: 'when it holds / when it does not', kinds: ['condition'], min: 0, max: 2 },
    ],
    relations: [
      { rule: 'each', from: 'mechanism', to: 'consequence', type: 'causes' },
      { rule: 'each', from: 'condition', to: 'consequence', type: 'applies_within' },
    ],
  },
  compare: {
    type: 'compare',
    slots: [
      { id: 'side_a', text: 'the first thing, defined', kinds: ['definition'], min: 1, max: 1, framing: true },
      { id: 'side_b', text: 'the second thing, defined', kinds: ['definition'], min: 1, max: 1, framing: true },
      { id: 'difference', text: 'the difference that decides which to use', kinds: ['contrast', 'mechanism'], min: 1, max: 2 },
      { id: 'when', text: 'when each applies', kinds: ['condition'], min: 0, max: 2 },
    ],
    relations: [{ rule: 'each', from: 'side_a', to: 'side_b', type: 'confused_with' }],
  },
  scenario: {
    type: 'scenario',
    slots: [
      { id: 'situation', text: 'what the situation is', kinds: ['definition', 'contrast'], min: 1, max: 1 },
      { id: 'evidence', text: 'the evidence in the numbers or facts that says so', kinds: ['quantitative', 'condition'], min: 1, max: 3 },
      { id: 'reasoning', text: 'the reasoning from evidence to verdict', kinds: ['mechanism', 'causal'], min: 1, max: 2 },
      { id: 'verdict', text: 'what happens / what it is', kinds: ['causal', 'contrast', 'quantitative'], min: 1, max: 1 },
    ],
    relations: [
      { rule: 'each', from: 'evidence', to: 'reasoning', type: 'requires' },
      { rule: 'each', from: 'reasoning', to: 'verdict', type: 'causes' },
    ],
  },
  calculate: {
    type: 'calculate',
    slots: [
      { id: 'formula', text: 'the formula in words', kinds: ['quantitative', 'definition'], min: 1, max: 1 },
      { id: 'input', text: 'an input and where it comes from', kinds: ['quantitative', 'condition', 'definition'], min: 1, max: 3 },
      { id: 'driver', text: 'what moves the result', kinds: ['mechanism', 'causal'], min: 1, max: 2 },
    ],
    relations: [{ rule: 'each', from: 'input', to: 'formula', type: 'requires' }],
  },
}

export function templateFor(type: string | undefined): QuestionTemplate | null {
  return type && type in QUESTION_TEMPLATES ? QUESTION_TEMPLATES[type as QuestionType] : null
}

export interface TemplateContext {
  /** The number of items the question or card lists, when known (enumerate). */
  listCount?: number
}

/** A slot's effective bounds: the list count replaces min/max on a count-driven slot. */
export function slotBounds(s: SlotSpec, ctx: TemplateContext = {}): { min: number; max: number } {
  if (s.countFromList && ctx.listCount && ctx.listCount > 0) return { min: ctx.listCount, max: ctx.listCount }
  return { min: s.min, max: s.max }
}

/** The smallest set that fills a template; the ceiling is this plus OVERFLOW. */
export function templateMinimum(t: QuestionTemplate, ctx: TemplateContext = {}): number {
  return t.slots.reduce((n, s) => n + slotBounds(s, ctx).min, 0)
}
export function templateCeiling(t: QuestionTemplate, ctx: TemplateContext = {}): number {
  return templateMinimum(t, ctx) + TEMPLATE_OVERFLOW
}

export interface SlottedPoint {
  index: number
  slot: string | null
  kind: string
}

export type TemplateDefect =
  | { rule: 'slot_unfilled'; slot: string; detail: string }
  | { rule: 'slot_overfull'; slot: string; detail: string }
  | { rule: 'slot_unknown'; index: number; slot: string; detail: string }
  | { rule: 'slot_kind'; index: number; slot: string; detail: string }
  | { rule: 'unslotted'; index: number; detail: string }
  | { rule: 'over_ceiling'; detail: string }

/**
 * Check a filled form. Every rule is a fact about the set the writer
 * returned; none is a judgment. `unslotted` points are the writer's overflow
 * — allowed up to the ceiling, never required.
 */
export function validateTemplate(t: QuestionTemplate, points: readonly SlottedPoint[], ctx: TemplateContext = {}): TemplateDefect[] {
  const out: TemplateDefect[] = []
  const bySlot = new Map<string, SlottedPoint[]>()
  for (const p of points) {
    if (!p.slot) { out.push({ rule: 'unslotted', index: p.index, detail: 'no slot — counts toward the overflow' }); continue }
    const spec = t.slots.find((s) => s.id === p.slot)
    if (!spec) { out.push({ rule: 'slot_unknown', index: p.index, slot: p.slot, detail: `"${p.slot}" is not a slot of the ${t.type} template` }); continue }
    if (spec.kinds.length && !(spec.kinds as readonly string[]).includes(p.kind)) {
      out.push({ rule: 'slot_kind', index: p.index, slot: p.slot, detail: `kind "${p.kind}" does not belong in "${p.slot}" (${spec.kinds.join('|')})` })
    }
    const list = bySlot.get(p.slot) ?? []
    list.push(p)
    bySlot.set(p.slot, list)
  }
  for (const s of t.slots) {
    const n = bySlot.get(s.id)?.length ?? 0
    const { min, max } = slotBounds(s, ctx)
    if (n < min) out.push({ rule: 'slot_unfilled', slot: s.id, detail: `"${s.id}" needs ${min}, has ${n}: ${s.text}` })
    if (n > max) out.push({ rule: 'slot_overfull', slot: s.id, detail: `"${s.id}" holds ${n}, at most ${max}` })
  }
  const ceiling = templateCeiling(t, ctx)
  if (points.length > ceiling) out.push({ rule: 'over_ceiling', detail: `${points.length} points; the ${t.type} template allows at most ${ceiling} (${templateMinimum(t, ctx)} + ${TEMPLATE_OVERFLOW})` })
  return out
}

export interface TemplateEdge {
  from: number
  to: number
  type: RelationRule extends infer R ? (R extends { type: infer T } ? T : never) : never
}

/** The links the shape implies, from the filled slots — deterministic, provenance `template`. */
export function templateEdges(t: QuestionTemplate, points: readonly SlottedPoint[]): TemplateEdge[] {
  const inSlot = (id: string) => points.filter((p) => p.slot === id).sort((a, b) => a.index - b.index)
  const out: TemplateEdge[] = []
  for (const r of t.relations) {
    if (r.rule === 'chain') {
      const ps = inSlot(r.slot)
      for (let i = 1; i < ps.length; i++) out.push({ from: ps[i - 1].index, to: ps[i].index, type: r.type })
    } else {
      for (const a of inSlot(r.from)) for (const b of inSlot(r.to)) if (a.index !== b.index) out.push({ from: a.index, to: b.index, type: r.type })
    }
  }
  return out
}

/** The template rendered for the writer: one line per slot, plus the size rule. */
export function templatePromptBlock(t: QuestionTemplate, ctx: TemplateContext = {}): string {
  const slots = t.slots.map((s) => { const b = slotBounds(s, ctx); return `  - "${s.id}"${b.min === 0 ? ' (optional)' : ''}: ${s.text} — ${b.min === b.max ? `exactly ${b.min}` : `${b.min}-${b.max}`} point(s)${s.kinds.length ? `, kind ${s.kinds.join(' | ')}` : ''}` }).join('\n')
  return `THE ${t.type.toUpperCase()} TEMPLATE — fill every slot that is not optional; each key point names its "slot":
${slots}
  Up to ${TEMPLATE_OVERFLOW} further points may carry no slot (slot null) when the card genuinely needs them; the whole set is at most ${templateCeiling(t, ctx)} points. A slot the card's definition gives you nothing to fill goes UNFILLED and is named in "concerns" as "UNFILLED SLOT: <slot> — <why>"; never invent a point to fill a slot.`
}

/** All seven templates, compactly — the writer picks the one for its questionType. */
export function allTemplatesPromptBlock(): string {
  return Object.values(QUESTION_TEMPLATES).map((t) => `${t.type}: ${t.slots.map((s) => `${s.id}${s.min === 0 ? '?' : ''} ×${s.min === s.max ? s.min : `${s.min}-${s.max}`}`).join(', ')}`).join('\n')
}
