import { prisma } from '../src/lib/db'
import { klpSourceHash } from '../src/lib/cards/klp-hash'
import { findDonors, pickDonor, copyKlps } from '../src/lib/klp/reuse'

/**
 * `npm run reuse-klps -- --set <setId> [--apply]` — copy key points onto cards
 * that are byte-identical to a card which already has them.
 *
 * DRY BY DEFAULT. It reports what it would copy and changes nothing unless
 * `--apply` is passed, because the write supersedes the recipient's existing
 * key points and that is not something to discover after the fact.
 *
 * Zero AI calls. Every match is an exact `klpSourceHash` equality, so this is
 * pure database work — see `src/lib/klp/reuse.ts` for why it is exact-match
 * and not a similarity search.
 */

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const setId = opt(args, '--set')
  const apply = args.includes('--apply')

  if (!setId) {
    console.error('[reuse-klps] --set <setId> is required')
    process.exitCode = 1
    return
  }

  const set = await prisma.set.findUnique({ where: { id: setId }, select: { title: true } })
  if (!set) {
    console.error(`[reuse-klps] no set ${setId}`)
    process.exitCode = 1
    return
  }

  const cards = await prisma.card.findMany({
    where: { setId },
    select: {
      id: true,
      term: true,
      definition: true,
      contentBlocks: {
        select: { side: true, type: true, text: true, assetId: true, position: true },
      },
      klps: { where: { supersededAt: null }, select: { id: true } },
    },
  })

  console.log(
    `[reuse-klps] ${set.title} — ${cards.length} cards${apply ? '' : ' (DRY RUN, pass --apply to write)'}`,
  )

  let reusable = 0
  let copiedTotal = 0
  let alreadyHave = 0

  for (const card of cards) {
    const hash = klpSourceHash({
      term: card.term,
      definition: card.definition,
      blocks: card.contentBlocks,
    })

    const donor = pickDonor(await findDonors(prisma, card.id, hash))
    if (!donor) continue

    // A card that already has key points is reported but NOT overwritten by
    // default. Its own may be better, or may carry a learner's evidence; the
    // operator decides, and the number is what makes the decision possible.
    if (card.klps.length > 0) {
      alreadyHave++
      continue
    }

    reusable++
    const label = card.term.replace(/\s+/g, ' ').slice(0, 60)
    if (!apply) {
      console.log(`  would copy ${donor.klpCount} KLP(s) (v${donor.promptVersion}) -> ${label}`)
      continue
    }

    const result = await copyKlps(prisma, card.id, donor, hash)
    copiedTotal += result.copied
    console.log(`  copied ${result.copied} KLP(s) (v${result.promptVersion}) -> ${label}`)
  }

  console.log(
    `[reuse-klps] ${reusable} card(s) can reuse; ${alreadyHave} matched a donor but already have ` +
      `their own key points (left alone)${apply ? `; ${copiedTotal} KLP(s) copied` : ''}`,
  )
  if (reusable > 0 && !apply) {
    // ~10 AI calls per card is the authoring pipeline's measured cost.
    console.log(`[reuse-klps] re-run with --apply to save roughly ${reusable * 10} AI calls`)
  }
}

main()
  .catch((error) => {
    console.error('[reuse-klps] failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
