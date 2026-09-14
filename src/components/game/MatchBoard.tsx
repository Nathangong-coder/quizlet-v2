'use client'

import { useState } from 'react'
import { MatchGame } from '@/components/game/MatchGame'
import { initMatchGame } from '@/lib/game/match'
import { dealMatch } from '@/lib/games/match-deal'
import { freshSeed, mulberry32 } from '@/lib/games/rng'
import type { GamePieceLike } from '@/lib/games/pieces'

/**
 * Deals a board from the set's pieces and re-deals on "Play again" without a
 * reload. The seed is read at the click, so the deal is reproducible from it
 * and the component stays pure otherwise.
 */
export function MatchBoard({ setId, pieces, signedIn, initialSeed }: { setId: string; pieces: GamePieceLike[]; signedIn: boolean; initialSeed: number }) {
  const [seed, setSeed] = useState(initialSeed)
  const cards = dealMatch(pieces, seed)
  return (
    <MatchGame
      key={seed}
      setId={setId}
      signedIn={signedIn}
      initialTiles={initMatchGame(cards, String(seed), mulberry32(seed ^ 0x5bd1e995)).tiles}
      onAgain={() => setSeed(freshSeed())}
    />
  )
}
