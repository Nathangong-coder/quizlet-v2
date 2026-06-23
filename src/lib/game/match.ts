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

  // 5. No match - reset selection to the new tile
  return {
    ...state,
    selectedTileId: tileId,
  };
}

/**
 * Checks if all tiles in the game have been matched.
 */
export function isComplete(state: MatchGameState): boolean {
  return state.matched.length === state.tiles.length;
}
