import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@fansong/engine';
import { AI_MAPS, everyMapCompletes, playOn, sameSizeMatchup } from './harness.js';

describe('every built-in map: capture-the-flag', () => everyMapCompletes('capture-the-flag'));

describe('AI in capture-the-flag', () => {
  for (const map of AI_MAPS) {
    it(`${map.id}: games complete, and the AI goes for the flags`, () => {
      let pickups = 0;
      let captures = 0;
      // A capture needs the AI to grab the flag *and* survive the walk home, which
      // it manages on roughly half the seeds on the stingiest map. Three seeds would
      // therefore fail about one AI change in six on luck alone; eight makes this an
      // assertion about the AI rather than about the seeds it happened to draw.
      for (let seed = 1; seed <= 8; seed++) {
        const events: GameEvent[] = [];
        const presets: [string, string] = sameSizeMatchup(seed, 1);
        const final = playOn(map, seed, presets, 'capture-the-flag', events);
        expect(final.phase).toBe('gameOver');
        pickups += events.filter((e) => e.type === 'FlagPickedUp').length;
        captures += events.filter((e) => e.type === 'FlagCaptured').length;
      }
      expect(pickups).toBeGreaterThanOrEqual(1);
      expect(captures).toBeGreaterThanOrEqual(1);
    });
  }
});
