import { composeSetWhere } from '@/lib/sets/visibility'
import { gameAvailability, playablePieces, type GameAvailability, type GameId, type GamePieceLike } from '@/lib/games/pieces'
import { rankScores, GAME_MODES, LEADERBOARD_SIZE, type RankedRow } from '@/lib/games/scores'

/**
 * Game reads. Every set read composes `readableSetWhere`; nothing here
 * writes. `@/lib/db` is imported dynamically so the pure modules beside this
 * one test without `DATABASE_URL`.
 */

export interface PrepareSummary {
  made: number
  copied: number
  generated: number
  skipped: { cardId: string; reason: string }[]
  failed: { cardId: string; kind: string }[]
}

export interface GamesHub {
  set: { id: string; title: string; subject: string | null; isOwner: boolean; gamesPreparedAt: Date | null; summary: PrepareSummary | null }
  cardCount: number
  readyCards: number
  pieceCount: number
  availability: Record<GameId, GameAvailability>
}

/** Live pieces = rows whose klpVersion matches their card's current version. */
export async function loadLivePieces(setId: string): Promise<(GamePieceLike & { klpVersion: number })[]> {
  const { prisma } = await import('@/lib/db')
  const rows = await prisma.gamePiece.findMany({
    where: { setId },
    select: { id: true, cardId: true, klpId: true, kind: true, prompt: true, answer: true, aliases: true, enabled: true, klpVersion: true, card: { select: { klpVersion: true } } },
  })
  return rows
    .filter((r) => r.klpVersion === r.card.klpVersion)
    .map((r) => ({ id: r.id, cardId: r.cardId, klpId: r.klpId, kind: r.kind, prompt: r.prompt, answer: r.answer, aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [], enabled: r.enabled, klpVersion: r.klpVersion }))
}

export async function loadGamesHub(viewerId: string | null, setId: string): Promise<GamesHub | null> {
  const { prisma } = await import('@/lib/db')
  const set = await prisma.set.findFirst({
    where: composeSetWhere(viewerId, { id: setId }),
    select: { id: true, title: true, subject: true, userId: true, gamesPreparedAt: true, gamesPrepareSummary: true, _count: { select: { cards: true } } },
  })
  if (!set) return null
  const [readyCards, pieces] = await Promise.all([
    prisma.card.count({ where: { setId, klpStatus: 'ready' } }),
    loadLivePieces(setId),
  ])
  return {
    set: {
      id: set.id,
      title: set.title,
      subject: set.subject,
      isOwner: viewerId !== null && viewerId === set.userId,
      gamesPreparedAt: set.gamesPreparedAt,
      summary: (set.gamesPrepareSummary as PrepareSummary | null) ?? null,
    },
    cardCount: set._count.cards,
    readyCards,
    pieceCount: playablePieces(pieces).length,
    availability: gameAvailability({ pieces, readyCards, signedIn: viewerId !== null }),
  }
}

/** The set's playable pieces (enabled, deduped), for Blitz / Crossword / Match. Null when unreadable. */
export async function loadPlayablePieces(viewerId: string | null, setId: string): Promise<{ title: string; pieces: GamePieceLike[] } | null> {
  const { prisma } = await import('@/lib/db')
  const set = await prisma.set.findFirst({ where: composeSetWhere(viewerId, { id: setId }), select: { title: true } })
  if (!set) return null
  return { title: set.title, pieces: playablePieces(await loadLivePieces(setId)) }
}

export interface PieceRow extends GamePieceLike {
  klpText: string | null
}

export interface PiecesView {
  set: { id: string; title: string; isOwner: boolean }
  cards: { id: string; term: string; klpStatus: string; pieces: PieceRow[] }[]
}

/** The pieces page: every card, its live pieces with their source key point, and cards that produced nothing. */
export async function loadPiecesView(viewerId: string | null, setId: string): Promise<PiecesView | null> {
  const { prisma } = await import('@/lib/db')
  const set = await prisma.set.findFirst({
    where: composeSetWhere(viewerId, { id: setId }),
    select: { id: true, title: true, userId: true, cards: { orderBy: { position: 'asc' }, select: { id: true, term: true, klpStatus: true } } },
  })
  if (!set) return null
  const pieces = await loadLivePieces(setId)
  const klpIds = pieces.map((p) => p.klpId).filter((id): id is string => id !== null)
  const klps = klpIds.length ? await prisma.cardKlp.findMany({ where: { id: { in: klpIds } }, select: { id: true, text: true } }) : []
  const klpText = new Map(klps.map((k) => [k.id, k.text]))
  const byCard = new Map<string, PieceRow[]>()
  for (const p of pieces) {
    const list = byCard.get(p.cardId) ?? []
    list.push({ ...p, klpText: p.klpId ? (klpText.get(p.klpId) ?? null) : null })
    byCard.set(p.cardId, list)
  }
  return {
    set: { id: set.id, title: set.title, isOwner: viewerId !== null && viewerId === set.userId },
    cards: set.cards.map((c) => ({ id: c.id, term: c.term, klpStatus: c.klpStatus, pieces: byCard.get(c.id) ?? [] })),
  }
}

// ------------------------------------------------------------ leaderboards

export interface Board {
  game: GameId
  mode: string
  rows: RankedRow[]
}

/**
 * One board: the set's best run per player for (game, mode), readable by
 * anyone who can read the set. Reads a bounded window of the best rows and
 * lets `rankScores` collapse them to one per player.
 */
export async function loadLeaderboard(viewerId: string | null, setId: string, game: GameId, mode: string): Promise<Board | null> {
  const { prisma } = await import('@/lib/db')
  if (!GAME_MODES[game]?.includes(mode)) return null
  const set = await prisma.set.findFirst({ where: composeSetWhere(viewerId, { id: setId }), select: { id: true } })
  if (!set) return null
  const rows = await prisma.gameScore.findMany({
    where: { setId, game, mode },
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    take: LEADERBOARD_SIZE * 5,
    select: { userId: true, score: true, createdAt: true, meta: true, user: { select: { handle: true } } },
  })
  return { game, mode, rows: rankScores(rows.map((r) => ({ userId: r.userId, handle: r.user.handle, score: r.score, createdAt: r.createdAt, meta: r.meta }))) }
}

/** Every board for a set, for the hub. Unreadable set → null. */
export async function loadAllLeaderboards(viewerId: string | null, setId: string): Promise<Board[] | null> {
  const out: Board[] = []
  for (const [game, modes] of Object.entries(GAME_MODES) as [GameId, readonly string[]][]) {
    for (const mode of modes) {
      const b = await loadLeaderboard(viewerId, setId, game, mode)
      if (!b) return null
      out.push(b)
    }
  }
  return out
}
