/**
 * The operator twin of the set page's "Build key points" button (2026-09-16):
 * the same `buildSetStep` (`src/lib/klp/build-set.ts`), looped until the set
 * is ready, over the `--direct` env keys instead of the owner's stored
 * credentials — writer `KLP_AUTHOR_PROVIDER`/`KLP_AUTHOR_MODELS` (GLM), judge
 * and minter `KLP_DIRECT_PROVIDER`/`KLP_DIRECT_MODELS` (DeepSeek). Use it to
 * build a set from a machine that cannot decrypt stored keys (no
 * `GOOGLE_KEY_ENCRYPTION_SECRET` locally), or to watch a build step by step.
 *
 *   KLP_AUTHOR_PROVIDER=zai KLP_AUTHOR_MODELS=glm-5.3-flash KLP_DIRECT_PROVIDER=deepseek KLP_DIRECT_MODELS=deepseek-flash \
 *   npx tsx --conditions=react-server --env-file=.env scripts/build-set.ts --set <setId> [--status] [--max-steps N]
 */
import { generateText, Output } from 'ai'
import { prisma } from '../src/lib/db'
import { resolveLanguageModel } from '../src/lib/ai/providers'
import { readDirectPool, comboResolveInput } from '../src/lib/klp/direct-pool'
import { buildSetStep, setBuildStatus, type BuildGenerators } from '../src/lib/klp/build-set'
import type { AuthoringGenerator } from '../src/lib/klp/authoring'
import { AUTHOR_KLPS_PROMPT } from '../src/lib/ai/prompts/author-klps'
import { GRADE_CANDIDATE_PROMPT } from '../src/lib/ai/prompts/grade-candidate'
import { REVISE_KLPS_PROMPT } from '../src/lib/ai/prompts/revise-klps'
import { RELATE_KLPS_PROMPT } from '../src/lib/ai/prompts/relate-klps'
import { CLASSIFY_ABSTRACTION_PROMPT } from '../src/lib/ai/prompts/classify-abstraction'
import { WRITE_PANEL_PROMPT } from '../src/lib/ai/prompts/write-panel'
import { WRITE_ADVERSARIES_PROMPT } from '../src/lib/ai/prompts/write-adversaries'
import { WRITE_REBUILD_PROMPT, GRADE_COVERAGE_PROMPT, GRADE_PARITY_PROMPT } from '../src/lib/ai/prompts/rebuild'
import { REVIEW_REFERENCE_PROMPT, REVISE_REFERENCE_PROMPT, REVIEW_REBUILT_PROMPT } from '../src/lib/ai/prompts/review-reference'
import { CLASSIFY_ROLES_PROMPT } from '../src/lib/ai/prompts/classify-roles'
import { CardTopicProposalV2Schema } from '../src/lib/klp/topic-minting-v2'
import { RoundTripSchema } from '../src/lib/ai/prompts/roundtrip-assign'

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function directGenerators(): BuildGenerators {
  const judgeCombo = readDirectPool()[0]
  const writerCombo = readDirectPool(process.env, 'author')[0] ?? judgeCombo
  if (!judgeCombo) throw new Error('no direct pool: set KLP_DIRECT_PROVIDER / KLP_DIRECT_MODELS and the provider key')
  const judgeModel = resolveLanguageModel(comboResolveInput(judgeCombo))
  const writerModel = resolveLanguageModel(comboResolveInput(writerCombo))
  const call = async <T,>(model: ReturnType<typeof resolveLanguageModel>, prompt: string, schema: Parameters<typeof Output.object>[0]['schema']): Promise<T> => {
    const res = await generateText({ model, prompt, output: Output.object({ schema }), maxRetries: 1, temperature: 0 })
    return res.output as T
  }
  const judge = <T,>(p: string, s: Parameters<typeof Output.object>[0]['schema']) => call<T>(judgeModel, p, s)
  const write = <T,>(p: string, s: Parameters<typeof Output.object>[0]['schema']) => call<T>(writerModel, p, s)
  const authoring: AuthoringGenerator = {
    author: (input) => write(AUTHOR_KLPS_PROMPT.build({ setTitle: input.setTitle, term: input.question, definition: input.definition, minKlps: input.minKlps }), AUTHOR_KLPS_PROMPT.schema),
    grade: (input) => judge(GRADE_CANDIDATE_PROMPT.build({ ...input, strict: true }), GRADE_CANDIDATE_PROMPT.schema),
    revise: (input) => judge(REVISE_KLPS_PROMPT.build(input), REVISE_KLPS_PROMPT.schema),
    relate: (input) => judge(RELATE_KLPS_PROMPT.build(input), RELATE_KLPS_PROMPT.schema),
    classifyAbstraction: (input) => judge(CLASSIFY_ABSTRACTION_PROMPT.build(input), CLASSIFY_ABSTRACTION_PROMPT.schema),
    writePanel: (input) => judge(WRITE_PANEL_PROMPT.build(input), WRITE_PANEL_PROMPT.schema),
    writeAdversaries: (input) => judge(WRITE_ADVERSARIES_PROMPT.build(input), WRITE_ADVERSARIES_PROMPT.schema),
    classifyRoles: (input) => judge(CLASSIFY_ROLES_PROMPT.build(input), CLASSIFY_ROLES_PROMPT.schema),
    reviewReference: (input) => judge(REVIEW_REFERENCE_PROMPT.build(input), REVIEW_REFERENCE_PROMPT.schema),
    reviseReference: (input) => write(REVISE_REFERENCE_PROMPT.build(input), REVISE_REFERENCE_PROMPT.schema),
    reviewRebuilt: (input) => judge(REVIEW_REBUILT_PROMPT.build(input), REVIEW_REBUILT_PROMPT.schema),
    rebuild: (input) => judge(WRITE_REBUILD_PROMPT.build(input), WRITE_REBUILD_PROMPT.schema),
    gradeCoverage: (input) => judge(GRADE_COVERAGE_PROMPT.build({ ...input, strict: true }), GRADE_COVERAGE_PROMPT.schema),
    gradeParity: (input) => judge(GRADE_PARITY_PROMPT.build({ ...input, strict: true }), GRADE_PARITY_PROMPT.schema),
  }
  return {
    authoring,
    topic: {
      mint: (p) => judge(p, CardTopicProposalV2Schema),
      assign: (p) => judge(p, RoundTripSchema),
      revise: (p) => judge(p, CardTopicProposalV2Schema),
    },
  }
}

async function main() {
  const setId = opt('--set')
  if (!setId) throw new Error('--set <setId> is required')
  const set = await prisma.set.findUnique({ where: { id: setId }, select: { userId: true, title: true } })
  if (!set) throw new Error('no such set')
  console.log(`[build-set] ${set.title}: ${JSON.stringify(await setBuildStatus(setId))}`)
  if (process.argv.includes('--status')) { await prisma.$disconnect(); return }
  const generators = directGenerators()
  const maxSteps = Number(opt('--max-steps') ?? 200)
  for (let i = 0; i < maxSteps; i++) {
    const t = Date.now()
    const s = await buildSetStep(set.userId, setId, { budgetMs: 240_000, generators })
    console.log(`  step ${i + 1}: ${s.did} · ${s.cards.length} card${s.cards.length === 1 ? '' : 's'} · ${((Date.now() - t) / 1000).toFixed(0)}s${s.errors.length ? ' · errors ' + JSON.stringify(s.errors) : ''} → need ${s.status.needAuthoring} / ${s.status.needMinting} / ${s.status.needRebuild}`)
    if (s.did === 'nothing' || s.status.ready) break
    if (s.cards.length === 0 && s.errors.length) break
  }
  console.log(`[build-set] done: ${JSON.stringify(await setBuildStatus(setId))}`)
  await prisma.$disconnect()
}
main()
