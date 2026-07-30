export interface GameCard {
  id: string;
  term: string;
  definition: string;
}

export interface MatchTile {
  id: string;
  cardId: string;
  content: string;
  side: 'term' | 'definition';
}

export interface MatchGameState {
  sessionId: string;
  tiles: MatchTile[];
  matched: string[];
  /** Wrong-pairing count per cardId. A card matched on the first try has none. */
  misses: Record<string, number>;
  selectedTileId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

/**
 * Initializes a new matching game state.
 * Each card is split into two tiles: one for the term and one for the definition.
 * Tiles are shuffled.
 */
export function initMatchGame(cards: GameCard[], sessionId?: string): MatchGameState {
  const tiles: MatchTile[] = [];

  cards.forEach((card) => {
    tiles.push({
      id: crypto.randomUUID(),
      cardId: card.id,
      content: card.term,
      side: 'term',
    });
    tiles.push({
      id: crypto.randomUUID(),
      cardId: card.id,
      content: card.definition,
      side: 'definition',
    });
  });

  // Fisher-Yates Shuffle
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }

  return {
    sessionId: sessionId ?? crypto.randomUUID(),
    tiles,
    matched: [],
    misses: {},
    selectedTileId: null,
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * Handles tile selection logic.
 * If a tile is already matched, it's ignored.
 * If it's the first selection, it sets startedAt.
 * If it's the second selection and matches the first, both are added to matched.
 */
export function selectTile(state: MatchGameState, tileId: string): MatchGameState {
  // 1. Ignore if tile is already matched
  if (state.matched.includes(tileId)) {
    return state;
  }

  // 2. Ignore if selecting the same tile that's already selected
  if (state.selectedTileId === tileId) {
    return state;
  }

  const tile = state.tiles.find((t) => t.id === tileId);
  if (!tile) return state;

  // 3. First selection
  if (state.selectedTileId === null) {
    return {
      ...state,
      selectedTileId: tileId,
      startedAt: state.startedAt ?? Date.now(),
    };
  }

  // 4. Second selection - check for match
  const firstTile = state.tiles.find((t) => t.id === state.selectedTileId)!;

  if (firstTile.cardId === tile.cardId && firstTile.side !== tile.side) {
    // Match found
    const newMatched = [...state.matched, firstTile.id, tile.id];
    const newState: MatchGameState = {
      ...state,
      matched: newMatched,
      selectedTileId: null,
    };

    // Check if game is now complete
    if (isComplete(newState)) {
      newState.finishedAt = Date.now();
    }

    return newState;
  }

  // 5. No match - record a miss against both cards and reset selection to the new tile
  const misses = {
    ...state.misses,
    [firstTile.cardId]: (state.misses[firstTile.cardId] ?? 0) + 1,
    [tile.cardId]: (state.misses[tile.cardId] ?? 0) + 1,
  };

  return {
    ...state,
    misses,
    selectedTileId: tileId,
  };
}

/**
 * Checks if all tiles in the game have been matched.
 */
export function isComplete(state: MatchGameState): boolean {
  return state.matched.length === state.tiles.length;
}

/**
 * One result per distinct card. Correct means "matched on the first try":
 * recovering after a wrong guess still means the pairing wasn't known, which
 * is the signal study memory should record.
 */
export function matchResults(state: MatchGameState): { cardId: string; correct: boolean }[] {
  const cardIds = Array.from(new Set(state.tiles.map((t) => t.cardId)));
  return cardIds.map((cardId) => ({
    cardId,
    correct: (state.misses[cardId] ?? 0) === 0,
  }));
}
