/**
 * THE DISTINCTNESS MATCHER (2026-09-14, minting plan step 3).
 *
 * "Does this proposed concept already exist in the global vocabulary?" —
 * asked once per proposed name, before a `Klt` row is minted. Until now the
 * answer was exact `normalizedName` across sets (containment only within a
 * set), so "TVM" and "time value of money" minted as siblings. The stability
 * probe (docs/ai/model-performance.md) showed run-to-run wording jitter of
 * ~20 points even at temperature 0, so exact matching can never be enough.
 *
 * Pure and deterministic, in this order, first hit wins:
 *
 *   exact        normalized names equal (`normalizeName` already expands
 *                the abbreviation table and strips noise suffixes)
 *   alias        the name is a recorded alias of a topic (`KltAlias`)
 *   initials     one name is the initials of the other ("tvm" ⇄ "time value
 *                of money"), for names of three or more content words
 *   containment  one name's content tokens are a subset of the other's, with
 *                at least two shared ("accounting equation" ⊂ "fundamental
 *                accounting equation") — `sameConceptByRule`
 *   token        content-token overlap (Jaccard) at or above TOKEN_MATCH
 *
 * Between TOKEN_AMBIGUOUS and TOKEN_MATCH the matcher returns `ambiguous`
 * with its candidates: that pair is what a judge call is for, and only that
 * pair. Below it, `none` — mint. Two candidates tied on the same rule are
 * `ambiguous` too; the matcher never picks between equals by luck.
 *
 * Tokens are compared after `normalizeName` (lower-case, singular,
 * abbreviations expanded, noise suffixes dropped) with the reconciler's
 * filler list removed, so this is the same identity the reconciler already
 * uses between two models on one card, pointed at the corpus.
 */
import { normalizeName, sameConceptByRule } from '@/lib/klp/topic-reconcile'

export { normalizeName }

export const TOKEN_MATCH = 0.67
export const TOKEN_AMBIGUOUS = 0.4

const FILLERS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'vs', 'versus', 'with', 'by', 'at', 'from', 'as', 'into', 'over', 'under', 'between'])

export interface VocabEntry {
  kltId: string
  name: string
  normalizedName: string
  status?: string
  /** Normalized alias names. */
  aliases?: string[]
}

export type MatchRule = 'exact' | 'alias' | 'initials' | 'containment' | 'token'

export interface MatchCandidate {
  entry: VocabEntry
  rule: MatchRule
  score: number
}

export type MatchResult =
  | { kind: 'match'; entry: VocabEntry; rule: MatchRule; score: number }
  | { kind: 'ambiguous'; candidates: MatchCandidate[] }
  | { kind: 'none' }

export function contentTokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t && !FILLERS.has(t))
}

export function initialsOf(normalized: string): string | null {
  const toks = contentTokens(normalized)
  if (toks.length < 3) return null
  return toks.map((t) => t[0]).join('')
}

export function tokenJaccard(a: string, b: string): number {
  const A = new Set(contentTokens(a))
  const B = new Set(contentTokens(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter += 1
  return inter / (A.size + B.size - inter)
}

function ruleFor(proposalNorm: string, entry: VocabEntry): MatchCandidate | null {
  if (entry.normalizedName === proposalNorm) return { entry, rule: 'exact', score: 1 }
  if (entry.aliases?.includes(proposalNorm)) return { entry, rule: 'alias', score: 1 }
  const pi = initialsOf(proposalNorm)
  const ei = initialsOf(entry.normalizedName)
  if ((pi && pi === entry.normalizedName.replace(/ /g, '')) || (ei && ei === proposalNorm.replace(/ /g, ''))) {
    return { entry, rule: 'initials', score: 0.95 }
  }
  if (sameConceptByRule(proposalNorm, entry.normalizedName)) return { entry, rule: 'containment', score: 0.8 }
  const j = tokenJaccard(proposalNorm, entry.normalizedName)
  if (j >= TOKEN_AMBIGUOUS) return { entry, rule: 'token', score: j }
  return null
}

export function matchConcept(proposal: string, vocab: VocabEntry[]): MatchResult {
  const norm = normalizeName(proposal)
  if (!norm) return { kind: 'none' }
  const candidates: MatchCandidate[] = []
  for (const entry of vocab) {
    if (entry.status === 'retired') continue
    const c = ruleFor(norm, entry)
    if (c) candidates.push(c)
  }
  if (candidates.length === 0) return { kind: 'none' }
  candidates.sort((a, b) => b.score - a.score || a.entry.normalizedName.length - b.entry.normalizedName.length)
  const best = candidates[0]
  const decisive = best.rule !== 'token' || best.score >= TOKEN_MATCH
  const tied = candidates.filter((c) => c !== best && Math.abs(c.score - best.score) < 1e-9 && c.rule === best.rule)
  // Containment can hold in both directions against different entries
  // ("working capital" ⊂ "net working capital" and ⊃ "capital"); two equal
  // containment hits are a real ambiguity, not a tie to break by length.
  if (decisive && tied.length === 0) return { kind: 'match', entry: best.entry, rule: best.rule, score: best.score }
  return { kind: 'ambiguous', candidates: candidates.slice(0, 4) }
}

export interface SweepDecision {
  proposal: string
  normalized: string
  result: MatchResult
  /** The vocabulary entry the proposal resolved to (matched, or newly added). */
  resolvedTo: VocabEntry
  /** 'existing' | 'new' | 'ambiguous-new' — the last when an ambiguity was left unresolved and the name minted. */
  outcome: 'existing' | 'new' | 'ambiguous-new'
}

/**
 * Cross-card accumulation: match each proposal against the vocabulary AS IT
 * GROWS, so a name minted by card 3 is available to card 40. Ambiguities are
 * recorded and, absent a judge, minted as new — the honest default, since
 * merging on a guess moves mastery and splitting does not.
 */
export function sweep(proposals: string[], vocab: VocabEntry[]): { decisions: SweepDecision[]; vocab: VocabEntry[] } {
  const v = vocab.map((e) => ({ ...e, aliases: [...(e.aliases ?? [])] }))
  const decisions: SweepDecision[] = []
  for (const proposal of proposals) {
    const norm = normalizeName(proposal)
    const result = matchConcept(proposal, v)
    if (result.kind === 'match') {
      if (result.rule !== 'exact' && result.rule !== 'alias') result.entry.aliases!.push(norm)
      decisions.push({ proposal, normalized: norm, result, resolvedTo: result.entry, outcome: 'existing' })
      continue
    }
    const entry: VocabEntry = { kltId: `new:${norm}`, name: proposal, normalizedName: norm, status: 'candidate', aliases: [] }
    v.push(entry)
    decisions.push({ proposal, normalized: norm, result, resolvedTo: entry, outcome: result.kind === 'ambiguous' ? 'ambiguous-new' : 'new' })
  }
  return { decisions, vocab: v }
}
