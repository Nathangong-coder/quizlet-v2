import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateJson, generateJsonWithMeta } from '@/lib/ai/generate'
import { authorCard, type AuthoringGenerator } from '@/lib/klp/authoring'
import { persistAuthoring } from '@/lib/klp/authoring-persist'
import { AUTHOR_KLPS_PROMPT } from '@/lib/ai/prompts/author-klps'
import { GRADE_CANDIDATE_PROMPT } from '@/lib/ai/prompts/grade-candidate'
import { REVISE_KLPS_PROMPT } from '@/lib/ai/prompts/revise-klps'
import { RELATE_KLPS_PROMPT } from '@/lib/ai/prompts/relate-klps'
import { classifyProviderError } from '@/lib/errors/classify'
import {
  CARDS_PER_RUN,
  findUnauthoredCards,
  sweepReusable,
  outOfTime,
} from '@/lib/klp/background-authoring'

/**
 * Nightly-ish background authoring, so the free tier is never left unspent.
 *
 * WHY A CRON AT ALL. The Google free-tier cap is 20 requests per day PER MODEL
 * per project, and it does not accumulate — quota not used today is gone. One
 * card costs 6-16 calls, so the whole daily allowance is roughly two cards per
 * model. Nobody is going to run an operator script several times a day for two
 * cards, which is exactly why ~180 cards have sat unauthored: the work is
 * small, endless, and easy to forget. A schedule is the only thing that
 * actually spends a use-it-or-lose-it budget.
 *
 * WHY IT RUNS OFTEN AND DOES LITTLE. Every invocation authors at most
 * `CARDS_PER_RUN` cards inside a wall-clock budget under the platform's
 * function ceiling. A single greedy nightly run would exhaust every model at
 * 03:00 and leave 23 hours of quota unused, and it would be killed mid-card by
 * the timeout.
 *
 * REUSE RUNS FIRST, always. A card identical to one that is already authored
 * is served from the database for zero requests. Authoring first and
 * deduplicating afterwards spends the scarce resource to reproduce something
 * that already exists.
 */

export const maxDuration = 300

/**
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations.
 *
 * With no secret configured the route refuses rather than running openly: this
 * endpoint spends the operator's AI quota, so an unauthenticated version of it
 * is a way for anyone who guesses the path to burn a day's budget. Failing
 * closed costs a missed run; failing open costs the quota.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

/**
 * The generator, wired to the stored credential pool of the operator account
 * named by `CRON_AUTHOR_USER_ID`.
 *
 * Background work belongs to no requesting user, so one has to be named
 * explicitly. An env var rather than "the first admin" because whose key pays
 * for this should be a deliberate, visible decision, not something that moves
 * when a role is granted.
 */
function generator(userId: string, onModel: (model: string) => void): AuthoringGenerator {
  return {
    author: async (input) => {
      const { value, meta } = await generateJsonWithMeta({
        userId,
        task: 'author',
        prompt: AUTHOR_KLPS_PROMPT.build({
          setTitle: input.setTitle,
          term: input.question,
          definition: input.definition,
          minKlps: input.minKlps,
        }),
        schema: AUTHOR_KLPS_PROMPT.schema,
      })
      onModel(meta.model)
      return value
    },
    grade: (input) =>
      generateJson({
        userId,
        task: 'author',
        prompt: GRADE_CANDIDATE_PROMPT.build(input),
        schema: GRADE_CANDIDATE_PROMPT.schema,
      }),
    revise: (input) =>
      generateJson({
        userId,
        task: 'author',
        prompt: REVISE_KLPS_PROMPT.build(input),
        schema: REVISE_KLPS_PROMPT.schema,
      }),
    relate: (input) =>
      generateJson({
        userId,
        task: 'author',
        prompt: RELATE_KLPS_PROMPT.build(input),
        schema: RELATE_KLPS_PROMPT.schema,
      }),
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = process.env.CRON_AUTHOR_USER_ID
  if (!userId) {
    return NextResponse.json(
      { error: 'CRON_AUTHOR_USER_ID is not set — no account to bill these calls to' },
      { status: 500 },
    )
  }

  const startedAt = Date.now()

  // Pull more candidates than will be authored: the reuse sweep may serve
  // several for free, and the run should still author a full batch after it.
  const candidates = await findUnauthoredCards(prisma, CARDS_PER_RUN * 4)
  const reused = await sweepReusable(prisma, candidates)
  const reusedIds = new Set(reused.map((r) => r.cardId))

  const authored: { cardId: string; separation: number; klps: number; status: string }[] = []
  const failed: { cardId: string; kind: string }[] = []

  for (const card of candidates.filter((c) => !reusedIds.has(c.id))) {
    if (authored.length >= CARDS_PER_RUN) break
    if (outOfTime(startedAt, Date.now())) break

    let model: string | undefined
    try {
      const outcome = await authorCard(
        {
          setTitle: card.setTitle,
          question: card.term,
          definition: card.definition,
        },
        generator(userId, (m) => {
          model = m
        }),
      )
      await persistAuthoring(
        card.id,
        outcome,
        AUTHOR_KLPS_PROMPT.version,
        { term: card.term, definition: card.definition, blocks: card.blocks },
        model,
      )
      authored.push({
        cardId: card.id,
        separation: outcome.separationScore,
        klps: outcome.klps.length,
        status: outcome.status,
      })
    } catch (error) {
      const kind = classifyProviderError(error)
      failed.push({ cardId: card.id, kind })
      // A daily cap is not a transient error and the next card would hit the
      // same wall on the same model. Stopping keeps one honest failure in the
      // log instead of a batch of identical ones, and leaves the remaining
      // cards for the next scheduled run.
      if (kind === 'quota_exhausted' || kind === 'no_credentials') break
    }
  }

  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - startedAt,
    reused,
    authored,
    failed,
  })
}
