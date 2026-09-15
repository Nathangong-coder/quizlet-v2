import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { loadStartSets } from '@/lib/home/start-here'
import { StartHerePage } from '@/components/home/StartHere'
import { PixelSprite } from '@/components/games/PixelSprite'
import { KNIGHT, KNIGHT_SHIELD, HOST_BASE, FACES, SLIME, MAGICIAN } from '@/lib/games/sprites'

export const metadata: Metadata = { title: 'Games' }

/** `/games` — Start here → Games: pick a set and its games hub opens. */
export default async function GamesHub() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Fgames')
  const sets = await loadStartSets(session.user.id)
  return (
    <StartHerePage
      title="Games"
      lede="Five games built from a set: Gauntlet, Hot Seat, Blitz, Crossword and Match. Just for fun — nothing a game sees goes into your record; the only thing saved is your place on the set’s leaderboard."
      intro={
        <div className="flex flex-wrap items-end gap-6 rounded-2xl bg-accent p-5">
          {[
            [KNIGHT, [KNIGHT_SHIELD], 'Gauntlet — a knight, 100 HP, twelve enemies'],
            [HOST_BASE, [FACES.pleased], 'Hot Seat — an interviewer whose face you can read'],
            [SLIME, [], 'Blitz & Crossword — short prompts, fast hands'],
            [MAGICIAN, [], 'Match — eight pairs against the clock'],
          ].map(([sprite, overlays, caption]) => (
            <div key={caption as string} className="flex items-center gap-3 text-sm text-accent-foreground">
              <PixelSprite sprite={sprite as typeof KNIGHT} overlays={overlays as typeof KNIGHT[]} size={48} />
              <span className="max-w-44">{caption as string}</span>
            </div>
          ))}
        </div>
      }
      sets={sets}
      hrefFor={(s) => `/sets/${s.id}/games`}
      cta="Play"
      disabledWhen={(s) => (s.cardCount < 2 ? 'Needs more cards' : null)}
      empty={<>No sets yet. <Link href="/browse" className="text-primary underline-offset-4 hover:underline">Find a public set</Link> — every game is open on those.</>}
    />
  )
}
