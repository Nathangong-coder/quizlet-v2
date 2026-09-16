/**
 * THE IN-APP GENERATORS (2026-09-16). The authoring pipeline and the minting
 * loop were run from operator scripts over `--direct` env keys; a set owner
 * had no way to run them. These build the same two generator objects over
 * `generateJson`, i.e. the user's own credentials, the keys lent to them and
 * the shared weekly budget — whatever `resolveCandidates` allows the account.
 *
 * ROLE SPLIT BY TASK. The measured production configuration is "GLM writes,
 * DeepSeek judges" (docs/ai/model-performance.md). `TASK_PROVIDER_PREFERENCE`
 * already orders `author` Z.ai-first and the judgment tasks DeepSeek-first,
 * so the writer calls go out as task `author` and every judging call —
 * grading the traps, reviewing the reference, the rebuild test, classifying
 * roles, relating — as task `klp-extract` ("key point extraction,
 * background"). Minting is `concept-tree`. A user's routing pins still win,
 * exactly as they do for a quiz. Nothing here chooses a model by name.
 *
 * The traps are written by the JUDGE side (the script's
 * `KLP_ADVERSARIES_WITH=grader`), so they are graded by a different family
 * than wrote the reference even when a user holds only one provider.
 */
import { generateJson, generateJsonWithMeta } from '@/lib/ai/generate'
import type { AuthoringGenerator } from '@/lib/klp/authoring'
import type { TopicGenerator } from '@/lib/klp/topic-loop'
import { AUTHOR_KLPS_PROMPT } from '@/lib/ai/prompts/author-klps'
import { GRADE_CANDIDATE_PROMPT } from '@/lib/ai/prompts/grade-candidate'
import { REVISE_KLPS_PROMPT } from '@/lib/ai/prompts/revise-klps'
import { RELATE_KLPS_PROMPT } from '@/lib/ai/prompts/relate-klps'
import { CLASSIFY_ABSTRACTION_PROMPT } from '@/lib/ai/prompts/classify-abstraction'
import { WRITE_PANEL_PROMPT } from '@/lib/ai/prompts/write-panel'
import { WRITE_ADVERSARIES_PROMPT } from '@/lib/ai/prompts/write-adversaries'
import { WRITE_REBUILD_PROMPT, GRADE_COVERAGE_PROMPT, GRADE_PARITY_PROMPT } from '@/lib/ai/prompts/rebuild'
import { REVIEW_REFERENCE_PROMPT, REVISE_REFERENCE_PROMPT, REVIEW_REBUILT_PROMPT } from '@/lib/ai/prompts/review-reference'
import { CLASSIFY_ROLES_PROMPT } from '@/lib/ai/prompts/classify-roles'
import { CardTopicProposalV2Schema } from '@/lib/klp/topic-minting-v2'
import { RoundTripSchema } from '@/lib/ai/prompts/roundtrip-assign'

const WRITER = 'author' as const
const JUDGE = 'klp-extract' as const
const MINTER = 'concept-tree' as const

export function authoringGenerator(userId: string, onModel?: (model: string) => void): AuthoringGenerator {
  // ATTRIBUTION: only the WRITER's model is recorded (`CardAuthoring.model`,
  // via `generateJsonWithMeta` in `author` below); the judging calls discard
  // theirs because the persisted artifact is the writer's — the same rule the
  // cron route followed — and `AiCallLog` keeps the served model per call.
  const judge = <T>(prompt: string, schema: Parameters<typeof generateJson<T>>[0]['schema']) => generateJson<T>({ userId, task: JUDGE, prompt, schema })
  const write = <T>(prompt: string, schema: Parameters<typeof generateJson<T>>[0]['schema']) => generateJson<T>({ userId, task: WRITER, prompt, schema })
  return {
    author: async (input) => {
      const { value, meta } = await generateJsonWithMeta({
        userId,
        task: WRITER,
        prompt: AUTHOR_KLPS_PROMPT.build({ setTitle: input.setTitle, term: input.question, definition: input.definition, minKlps: input.minKlps }),
        schema: AUTHOR_KLPS_PROMPT.schema,
      })
      onModel?.(meta.model)
      return value
    },
    grade: (input) => judge(GRADE_CANDIDATE_PROMPT.build({ ...input, strict: true }), GRADE_CANDIDATE_PROMPT.schema),
    // the bar's revise calls go to the judge ("GLM writes, DeepSeek revises")
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
}

/**
 * The minted fragment is stored on the card (`Card.topicProposal`) without a
 * model column; the tree write records 'in-app' on every KltRelation it
 * creates, and `AiCallLog` carries the served model per call.
 */
export function topicGenerator(userId: string): TopicGenerator {
  // ATTRIBUTION: see above — the fragment has no model column; AiCallLog has the model.
  return {
    mint: (prompt) => generateJson({ userId, task: MINTER, prompt, schema: CardTopicProposalV2Schema }),
    assign: (prompt) => generateJson({ userId, task: MINTER, prompt, schema: RoundTripSchema }),
    revise: (prompt) => generateJson({ userId, task: MINTER, prompt, schema: CardTopicProposalV2Schema }),
  }
}
