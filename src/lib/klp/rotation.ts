/**
 * Three-role rotation for authoring (owner, 2026-09-12): per card, a WRITER
 * (reference answer + key points + revisions), an ADVERSARY WRITER (the three
 * wrong answers, from the question and reference only), and a GRADER — each
 * from a DIFFERENT model family. The point is independence: the grader never
 * wrote the answer or the traps, and the traps were not tuned to the key
 * points. The owner's rule: Gemini cannot pair with Gemini, and DeepSeek
 * cannot pair with GLM — so those are the families.
 *
 * Pure. The combos come from the direct pool machinery (`direct-pool.ts`);
 * this module only decides who plays which role and rotates writers LRU.
 */
import type { DirectCombo } from './direct-pool'
import { selectAttemptOrder } from '@/lib/ai/key-pool'

/** Model family by PROVIDER (the pool source name), overridable per model. */
export const PROVIDER_FAMILY: Record<string, string> = {
  google: 'google',
  deepseek: 'cn',
  zai: 'cn',
  qwen: 'qwen',
}

export function familyOf(source: string): string {
  return PROVIDER_FAMILY[source] ?? source
}

export interface RotationCombo extends DirectCombo {
  /** The pool SOURCE (`google`, `deepseek`, `zai`, `qwen`) — `provider` on the
   * combo is the resolve id, which is `custom` for zai and qwen. */
  source: string
  family: string
}

export interface RoleAssignment {
  writer: RotationCombo
  adversary: RotationCombo
  grader: RotationCombo
}

/**
 * Parses `KLP_ROTATION`: `source:model,model;source:model;...`. Returns the
 * (source, model) pairs in declaration order; keys are attached by the caller.
 */
export function parseRotationSpec(spec: string | undefined): { source: string; model: string }[] {
  if (!spec) return []
  const out: { source: string; model: string }[] = []
  for (const part of spec.split(';')) {
    const [rawSource, rawModels] = part.split(':')
    const source = rawSource?.trim().toLowerCase()
    if (!source || !rawModels) continue
    for (const m of rawModels.split(',')) {
      const model = m.trim()
      if (model) out.push({ source, model })
    }
  }
  return out
}

/**
 * Picks the three roles for one card.
 *
 * WRITER: least-recently-used enabled combo (via the same `selectAttemptOrder`
 * the pools use), so writers rotate across cards. ADVERSARY (who also serves
 * the rebuild): least-recently-used combo from a family other than the
 * writer's. GRADER: from a family other than the adversary's — it may share
 * the writer's family (the owner, 2026-09-12: "model 1 & 3 can be the same
 * family"), but must not grade traps it wrote. Two families are therefore
 * the minimum; with fewer the caller stops rather than collapsing two roles
 * onto one model.
 */
export function pickRoles(pool: RotationCombo[]): RoleAssignment | null {
  const ordered = selectAttemptOrder(pool) as RotationCombo[]
  const writer = ordered[0]
  if (!writer) return null
  const adversary = ordered.find((c) => c.family !== writer.family)
  if (!adversary) return null
  const grader =
    ordered.find((c) => c.family !== writer.family && c.family !== adversary.family) ??
    ordered.find((c) => c !== writer && c.family !== adversary.family) ??
    (writer.family !== adversary.family ? writer : undefined)
  if (!grader) return null
  return { writer, adversary, grader }
}

export function familiesAvailable(pool: RotationCombo[]): string[] {
  return [...new Set(pool.filter((c) => c.enabled).map((c) => c.family))]
}
