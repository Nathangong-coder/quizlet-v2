import { describe, it, expect, vi } from 'vitest';
import { initMatchGame, selectTile, isComplete, type GameCard, type MatchGameState } from '../../src/lib/game/match';

describe('Matching Game Logic', () => {
  const mockCards: GameCard[] = [
    { id: '1', term: 'Apple', definition: 'A red fruit' },
    { id: '2', term: 'Banana', definition: 'A yellow fruit' },
  ];

  describe('initMatchGame', () => {
    it('should initialize game state with correct number of tiles', () => {
      const state = initMatchGame(mockCards);
      // 2 cards * 2 tiles each = 4 tiles
      expect(state.tiles).toHaveLength(4);
    });

    it('should create two tiles (term and definition) for each card', () => {
      const state = initMatchGame(mockCards);
      const card1Tiles = state.tiles.filter(t => t.cardId === '1');
      const card2Tiles = state.tiles.filter(t => t.cardId === '2');

      expect(card1Tiles).toHaveLength(2);
      expect(card1Tiles.some(t => t.side === 'term' && t.content === 'Apple')).toBe(true);
      expect(card1Tiles.some(t => t.side === 'definition' && t.content === 'A red fruit')).toBe(true);

      expect(card2Tiles).toHaveLength(2);
      expect(card2Tiles.some(t => t.side === 'term' && t.content === 'Banana')).toBe(true);
      expect(card2Tiles.some(t => t.side === 'definition' && t.content === 'A yellow fruit')).toBe(true);
    });

    it('should generate a random sessionId if not provided', () => {
      const state = initMatchGame(mockCards);
      expect(state.sessionId).toBeDefined();
      expect(typeof state.sessionId).toBe('string');
      expect(state.sessionId.length).toBeGreaterThan(0);
    });

    it('should use provided sessionId if given', () => {
      const sessionId = 'test-session-123';
      const state = initMatchGame(mockCards, sessionId);
      expect(state.sessionId).toBe(sessionId);
    });

    it('should initialize state defaults', () => {
      const state = initMatchGame(mockCards);
      expect(state.matched).toEqual([]);
      expect(state.selectedTileId).toBeNull();
      expect(state.startedAt).toBeNull();
      expect(state.finishedAt).toBeNull();
    });

    it('should shuffle tiles', () => {
      // Use a larger set of cards to make accidental non-shuffled order highly unlikely
      const largeCards = Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        term: `Term ${i}`,
        definition: `Def ${i}`,
      }));

      const state1 = initMatchGame(largeCards);
      const state2 = initMatchGame(largeCards);

      // It's theoretically possible they are the same, but extremely unlikely
      expect(state1.tiles).not.toEqual(state2.tiles);
    });
  });

  describe('selectTile', () => {
    it('should set startedAt on the first tile selection', () => {
      const state = initMatchGame(mockCards);
      const tileId = state.tiles[0].id;

      const newState = selectTile(state, tileId);

      expect(newState.selectedTileId).toBe(tileId);
      expect(newState.startedAt).not.toBeNull();
      expect(typeof newState.startedAt).toBe('number');
    });

    it('should select a tile if none is currently selected', () => {
      const state = initMatchGame(mockCards);
      const tileId = state.tiles[0].id;
      const newState = selectTile(state, tileId);
      expect(newState.selectedTileId).toBe(tileId);
    });

    it('should match tiles if they belong to the same card but have different sides', () => {
      const state = initMatchGame(mockCards);
      const card1 = mockCards[0];
      const termTile = state.tiles.find(t => t.cardId === card1.id && t.side === 'term')!;
      const defTile = state.tiles.find(t => t.cardId === card1.id && t.side === 'definition')!;

      // Select first tile
      const state1 = selectTile(state, termTile.id);
      // Select second tile
      const state2 = selectTile(state1, defTile.id);

      expect(state2.matched).toContain(termTile.id);
      expect(state2.matched).toContain(defTile.id);
      expect(state2.selectedTileId).toBeNull();
    });

    it('should not match tiles if they belong to different cards', () => {
      const state = initMatchGame(mockCards);
      const card1TermTile = state.tiles.find(t => t.cardId === '1' && t.side === 'term')!;
      const card2TermTile = state.tiles.find(t => t.cardId === '2' && t.side === 'term')!;

      const state1 = selectTile(state, card1TermTile.id);
      const state2 = selectTile(state1, card2TermTile.id);

      expect(state2.matched).not.toContain(card1TermTile.id);
      expect(state2.matched).not.toContain(card2TermTile.id);
      expect(state2.selectedTileId).toBe(card2TermTile.id);
    });

    it('should not match tiles if they are the same side of the same card', () => {
      // This case shouldn't happen in a normal game but good for logic check
      const state = initMatchGame(mockCards);
      const termTile = state.tiles.find(t => t.cardId === '1' && t.side === 'term')!;

      const state1 = selectTile(state, termTile.id);
      const state2 = selectTile(state1, termTile.id); // Selecting same tile again

      expect(state2.matched).not.toContain(termTile.id);
      expect(state2.selectedTileId).toBe(termTile.id); // Should just remain selected or reset
    });

    it('should ignore selection if tile is already matched', () => {
      const state = initMatchGame(mockCards);
      const card1 = mockCards[0];
      const termTile = state.tiles.find(t => t.cardId === card1.id && t.side === 'term')!;
      const defTile = state.tiles.find(t => t.cardId === card1.id && t.side === 'definition')!;

      // Match them
      const state1 = selectTile(state, termTile.id);
      const state2 = selectTile(state1, defTile.id);

      // Try to select a matched tile
      const state3 = selectTile(state2, termTile.id);

      expect(state3.selectedTileId).toBeNull();
      expect(state3.matched).toHaveLength(2);
    });
  });

  describe('isComplete', () => {
    it('should return false if not all tiles are matched', () => {
      const state = initMatchGame(mockCards);
      expect(isComplete(state)).toBe(false);
    });

    it('should return true if all tiles are matched', () => {
      const state = initMatchGame(mockCards);
      const card1 = mockCards[0];
      const card2 = mockCards[1];
      const t1 = state.tiles.find(t => t.cardId === card1.id && t.side === 'term')!;
      const d1 = state.tiles.find(t => t.cardId === card1.id && t.side === 'definition')!;
      const t2 = state.tiles.find(t => t.cardId === card2.id && t.side === 'term')!;
      const d2 = state.tiles.find(t => t.cardId === card2.id && t.side === 'definition')!;

      let s = selectTile(state, t1.id);
      s = selectTile(s, d1.id);
      s = selectTile(s, t2.id);
      s = selectTile(s, d2.id);

      expect(isComplete(s)).toBe(true);
    });

    it('should set finishedAt when isComplete is called on a finished game', () => {
      // Note: The brief says "isComplete, finishedAt".
      // Usually isComplete is a getter/pure function.
      // Maybe the requirement is that selectTile should set finishedAt when the last match occurs.

      const state = initMatchGame(mockCards);
      const card1 = mockCards[0];
      const card2 = mockCards[1];
      const t1 = state.tiles.find(t => t.cardId === card1.id && t.side === 'term')!;
      const d1 = state.tiles.find(t => t.cardId === card1.id && t.side === 'definition')!;
      const t2 = state.tiles.find(t => t.cardId === card2.id && t.side === 'term')!;
      const d2 = state.tiles.find(t => t.cardId === card2.id && t.side === 'definition')!;

      let s = selectTile(state, t1.id);
      s = selectTile(s, d1.id);
      s = selectTile(s, t2.id);
      s = selectTile(s, d2.id);

      expect(s.finishedAt).not.toBeNull();
      expect(typeof s.finishedAt).toBe('number');
    });
  });
});
