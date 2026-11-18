/**
 * Pre-fill QuizOptionCache for every card of the demo set, so guests are
 * served AI-written Gauntlet options from cache at no cost (guest endpoints
 * never write the cache).
 *
 * Operator-only; not a guest path, so it carries no guard. Needs DEMO_SET_ID
 * and DEMO_AI_USER_ID but NOT DEMO_ENABLED.
 *
 * Run:
 *   npm run demo:prefill -- --dry-run   (counts only, no AI call)
 *   npm run demo:prefill
 */

import { prisma } from '../src/lib/db'
import { readDemoConfig } from '../src/lib/demo/config'
import { loadDemoSet } from '../src/lib/demo/demo-set'
import { generateJson, resolveTaskModel } from '../src/lib/ai/generate'
import { MULTIPLE_CHOICE_PROMPT } from '../src/lib/ai/prompts/registry'
import { MultipleChoiceKlpSchema, MultipleChoiceOptionsSchema } from '../src/lib/ai/schemas'
import { parseOptionCache } from '../src/lib/quiz/options'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const { setId, aiUserId } = readDemoConfig()
  if (!setId || !aiUserId) {
    console.error('DEMO_SET_ID and DEMO_AI_USER_ID must be set')
    process.exitCode = 1
    return
  }

  try {
    const set = await loadDemoSet(setId)
    if (!set) {
      console.error('Demo set not found or not readable signed out')
      process.exitCode = 1
      return
    }
    const model = await resolveTaskModel(aiUserId, 'distractors')
    if (!model) {
      console.error('No model resolves for the demo AI user (task: distractors)')
      process.exitCode = 1
      return
    }

    let generated = 0
    let cachedAlready = 0
    let failed = 0
    for (const card of set.cards) {
      const existing = await prisma.quizOptionCache.findUnique({ where: { cardId_model: { cardId: card.id, model } } })
      if (existing && parseOptionCache(existing.options)) {
        cachedAlready++
        continue
      }
      if (dryRun) {
        generated++
        continue
      }
      try {
        // Same generation and cache shape as gauntletOptions (src/actions/games.ts).
        // ATTRIBUTION: `model` from resolveTaskModel keys the cache row, as in
        // gauntletOptions and src/actions/quiz.ts.
        let optionsJson: object
        if (card.klps.length > 0) {
          const g = await generateJson({
            userId: aiUserId,
            task: 'distractors',
            schema: MultipleChoiceKlpSchema,
            prompt: MULTIPLE_CHOICE_PROMPT.build({ card: card as never, siblingCards: set.cards as never, klps: card.klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })) }),
          })
          optionsJson = {
            v: 2,
            correctAnswer: g.correctAnswer,
            options: [
              { text: g.correctAnswer, correct: true },
              ...g.distractors.map((d) => ({ text: d.text, correct: false, sourceKlpId: card.klps[d.klpRef]?.id, corruption: d.corruption })),
            ],
          }
        } else {
          // ATTRIBUTION: same cache row, keyed by the same `model` as above.
          const g = await generateJson({
            userId: aiUserId,
            task: 'distractors',
            schema: MultipleChoiceOptionsSchema,
            prompt: MULTIPLE_CHOICE_PROMPT.build({ card: card as never, siblingCards: set.cards as never }),
          })
          optionsJson = g
        }
        if (!parseOptionCache(optionsJson)) throw new Error('generated options failed parseOptionCache')
        await prisma.quizOptionCache.upsert({
          where: { cardId_model: { cardId: card.id, model } },
          create: { cardId: card.id, model, options: optionsJson },
          update: { options: optionsJson },
        })
        generated++
      } catch (error) {
        failed++
        console.error(`card ${card.id} failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      }
    }
    console.log(`${generated} ${dryRun ? 'would be generated' : 'generated'}, ${cachedAlready} already cached${failed ? `, ${failed} failed` : ''}${dryRun ? ' (dry run)' : ''}`)
    if (failed) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
