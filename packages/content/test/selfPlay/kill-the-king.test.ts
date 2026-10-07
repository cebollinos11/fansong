import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@fansong/engine';
import { AI_MAPS, everyMapCompletes, playOn, sameSizeMatchup } from './harness.js';

describe('every built-in map: kill-the-king', () => everyMapCompletes('kill-the-king'));

describe('AI in kill-the-king', () => {
  for (const map of AI_MAPS) {
    it(`${map.id}: games complete, with Kings actually falling`, () => {
      let byKing = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const events: GameEvent[] = [];
        const presets: [string, string] = sameSizeMatchup(seed, 1);
        const final = playOn(map, seed, presets, 'kill-the-king', events);
        expect(final.phase).toBe('gameOver');
        expect(final.winner === 0 || final.winner === 1).toBe(true);
        if (events.some((e) => e.type === 'GameOver' && e.reason === 'king')) {
          byKing++;
          // The loser's King is the one that fell; the winner's still stands.
          const [k0, k1] = final.mode!.kings!;
          const winnerKing = final.units.find((u) => u.id === (final.winner === 0 ? k0 : k1))!;
          expect(winnerKing.dead).toBe(false);
        }
      }
      expect(byKing).toBeGreaterThanOrEqual(2);
    });
  }
});
