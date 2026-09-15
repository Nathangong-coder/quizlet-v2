/**
 * THE WHOLE-CARD MINTING LOOP (2026-09-15) — the KLP pipeline's shape,
 * applied to topics: mint → measure → revise against named findings →
 * re-measure → keep the best round.
 *
 *   mint      prompt v2 (anchored), the card's own link graph supplied
 *   measure   KLT settings (deterministic) + klpKltEnforcement + round-trip
 *             recovery (one grader call: labels and points only)
 *   findings  every miss, named per point or per leaf, with the fix asked
 *   revise    ONE call carrying the whole proposal and the findings, returning
 *             the whole revised proposal (never a patch — a patch cannot
 *             re-anchor)
 *   veto      the round with the fewest bar misses wins, then the highest
 *             overall; a later round that made things worse is discarded
 *
 * Bars are PROVISIONAL (`TOPIC_BARS`) until the 278-card dry run sets them —
 * the same order the KLP bars were set in. Every number the loop reads is
 * computed in TypeScript; the model only proposes and assigns.
 */
import { buildTopicMintingPromptV2, type CardTopicProposalV2, toV1 } from '@/lib/klp/topic-minting-v2'
import { enforcementReport, renderLinks, type KlpLink, type EnforcementReport } from '@/lib/klp/topic-enforcement'
import { kltSettings, roundTripLabels, withRoundTrip, type KltSettingsReport } from '@/lib/klp/topic-settings'
import { ROUNDTRIP_ASSIGN_PROMPT, shuffleLabels, type RoundTripResult } from '@/lib/ai/prompts/roundtrip-assign'
import type { PromptKlp } from '@/lib/klp/topic-minting'
import { MAX_NAME_WORDS } from '@/lib/klp/topic-minting-v2'

export const TOPIC_BARS = {
  coverage: 1.0,
  enforcement: 1.0,
  anchored: 0.9,
  causalEdges: 0.9,
  brevity: 0.8,
  roundTrip: 0.75,
  distinctness: 0.9,
} as const

export const MAX_TOPIC_ROUNDS = 2

export interface TopicGenerator {
  mint(prompt: string): Promise<CardTopicProposalV2>
  assign(prompt: string): Promise<RoundTripResult>
  revise(prompt: string): Promise<CardTopicProposalV2>
}

export interface TopicFinding {
  /** A leaf name, a KLP index as "[n]", or null for the whole card. */
  where: string | null
  issue: string
  fix: string
}

export interface TopicRound {
  round: number
  proposal: CardTopicProposalV2
  settings: KltSettingsReport
  enforcement: EnforcementReport
  findings: TopicFinding[]
  barsMissed: string[]
}

export interface TopicLoopOutcome {
  term: string
  anchor: string
  domain: string
  proposal: CardTopicProposalV2
  settings: KltSettingsReport
  enforcement: EnforcementReport
  rounds: TopicRound[]
  keptRound: number
  status: 'clear' | 'flagged'
  /** The bars the kept round still misses. */
  flags: string[]
}

export function barsMissed(s: KltSettingsReport, e: EnforcementReport): string[] {
  const out: string[] = []
  if (s.coverage < TOPIC_BARS.coverage) out.push('coverage')
  if (e.klpKltEnforcement < TOPIC_BARS.enforcement) out.push('enforcement')
  if (s.anchored < TOPIC_BARS.anchored) out.push('anchored')
  if (s.causalEdges < TOPIC_BARS.causalEdges) out.push('causalEdges')
  if (s.brevity < TOPIC_BARS.brevity) out.push('brevity')
  if (s.distinctness < TOPIC_BARS.distinctness) out.push('distinctness')
  if (s.roundTrip !== undefined && s.roundTrip < TOPIC_BARS.roundTrip) out.push('roundTrip')
  return out
}

export function topicFindings(klps: { text: string; kind: string }[], s: KltSettingsReport, e: EnforcementReport): TopicFinding[] {
  const out: TopicFinding[] = []
  for (const i of s.detail.uncovered) out.push({ where: `[${i}]`, issue: 'not covered by any leaf or relation', fix: 'give this point a leaf, or a relation if it states a link — a context alone does not count' })
  for (const r of e.rows) {
    if (!r.violation) continue
    out.push({ where: `[${r.ref}]`, issue: `minted as ${r.minted} but intended ${r.intended} (${r.basis === 'link-source' ? 'it is the source of a known link' : 'its kind'})`, fix: r.intended === 'edge' ? 'make it a relation owned by this point: from = the cause (borrow the earlier point\'s leaf), to = the effect it states' : 'give it a leaf naming the thing it defines' })
  }
  for (const i of s.detail.causalAsLeaf) if (!e.rows[i]?.violation) out.push({ where: `[${i}]`, issue: 'a causal / "because" point minted as a leaf', fix: 'make it a relation owned by this point, typed causes or precedes, with causeKlpRef' })
  for (const n of s.detail.unanchored) out.push({ where: n, issue: 'does not branch from the anchor', fix: 'set "under" to the anchor or to the leaf on this card it is part of' })
  for (const n of s.detail.longNames) out.push({ where: n, issue: `longer than ${MAX_NAME_WORDS} words`, fix: 'split into a leaf and a sub-leaf under it, plain nouns' })
  for (const n of s.detail.containers) out.push({ where: n, issue: 'a statement or bucket name as a leaf', fix: 'name the thing the point is about, not where it happens' })
  for (const [a, b] of s.detail.indistinct) out.push({ where: a, issue: `near-duplicate of "${b}"`, fix: 'merge them, or rename one to the specific thing that makes it a different topic' })
  for (const w of s.detail.wandered ?? []) out.push({ where: `[${w[0]}]`, issue: `a grader shown only the labels filed this point under ${w[2] === null ? 'nothing' : `"${w[2]}"`}, not "${w[1]}"`, fix: w[2] === null ? 'the label does not describe the point; rename it in the point\'s own words' : 'the two labels are not distinct for this point; sharpen the one it belongs to or merge them' })
  return out
}

function renderProposal(p: CardTopicProposalV2): string {
  const leaves = p.leaves.map((l) => `  - "${l.name}" under "${l.under}" — points ${l.klpRefs.map((r) => `[${r}]`).join(' ')}`).join('\n')
  const rels = p.relations.map((r) => `  - [${r.klpRef}] "${r.from}" —${r.type}→ "${r.to}"${typeof r.causeKlpRef === 'number' ? ` (cause from [${r.causeKlpRef}])` : ''}`).join('\n')
  const ctx = p.contexts.map((c) => `  - [${c.klpRef}] in "${c.concept}"`).join('\n')
  return `anchor: "${p.anchor}" under domain "${p.domain}"\nleaves:\n${leaves || '  (none)'}\nrelations:\n${rels || '  (none)'}\ncontexts:\n${ctx || '  (none)'}`
}

export function buildTopicRevisePrompt(term: string, setTitle: string, klps: PromptKlp[], linksBlock: string, proposal: CardTopicProposalV2, findings: TopicFinding[]): string {
  const base = buildTopicMintingPromptV2(term, setTitle, klps, linksBlock)
  const list = findings.map((f) => `  - ${f.where ? `${f.where}: ` : ''}${f.issue} — ${f.fix}`).join('\n')
  return `${base}

YOU ALREADY PRODUCED THIS MAP FOR THE CARD:
${renderProposal(proposal)}

IT WAS CHECKED, AND THESE ARE THE FINDINGS — fix each one, leave everything else exactly as it is, and return the WHOLE map (not only the changed entries):
${list}`
}

export async function mintCardLoop(
  input: { term: string; setTitle: string; klps: { text: string; kind: string }[]; links: KlpLink[] },
  gen: TopicGenerator,
  opts: { seed?: number; maxRounds?: number } = {},
): Promise<TopicLoopOutcome> {
  const promptKlps: PromptKlp[] = input.klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind }))
  const linksBlock = renderLinks(input.links)
  const maxRounds = opts.maxRounds ?? MAX_TOPIC_ROUNDS
  const rounds: TopicRound[] = []

  let proposal = await gen.mint(buildTopicMintingPromptV2(input.term, input.setTitle, promptKlps, linksBlock))
  for (let round = 0; ; round++) {
    let settings = kltSettings({ klps: input.klps, proposal })
    const enforcement = enforcementReport(input.klps, input.links, toV1(proposal))
    // round-trip: labels and points only, labels shuffled
    const { labels } = roundTripLabels(proposal)
    if (labels.length > 0) {
      try {
        const assigned = await gen.assign(ROUNDTRIP_ASSIGN_PROMPT.build({ question: input.term, klps: input.klps, labels: shuffleLabels(labels, (opts.seed ?? 7) + round) }))
        settings = withRoundTrip(settings, proposal, assigned.assignments)
      } catch {
        // recovery unknown this round; the deterministic settings stand
      }
    }
    const findings = topicFindings(input.klps, settings, enforcement)
    const missed = barsMissed(settings, enforcement)
    rounds.push({ round, proposal, settings, enforcement, findings, barsMissed: missed })
    if (findings.length === 0 || round >= maxRounds) break
    try {
      proposal = await gen.revise(buildTopicRevisePrompt(input.term, input.setTitle, promptKlps, linksBlock, proposal, findings))
    } catch {
      break
    }
  }
  // the veto: fewest bars missed, then highest overall, then the earlier round
  let kept = 0
  for (let i = 1; i < rounds.length; i++) {
    const a = rounds[kept], b = rounds[i]
    if (b.barsMissed.length < a.barsMissed.length || (b.barsMissed.length === a.barsMissed.length && b.settings.overall > a.settings.overall + 1e-9)) kept = i
  }
  const k = rounds[kept]
  return { term: input.term, anchor: k.proposal.anchor, domain: k.proposal.domain, proposal: k.proposal, settings: k.settings, enforcement: k.enforcement, rounds, keptRound: kept, status: k.barsMissed.length === 0 ? 'clear' : 'flagged', flags: k.barsMissed }
}
