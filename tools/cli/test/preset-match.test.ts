import { describe, expect, it } from 'vitest';
import { chooseCommand } from '@fansong/ai';
import { buildMatch, DEFAULT_BOARD, PRESET_IDS, PRESETS } from '@fansong/content';
import { createGame, reduce, type GameState } from '@fansong/engine';

const STEP_CAP = 20_000;

function playPresetMatch(p0: string, p1: string, seed: number): GameState {
  const config = buildMatch(PRESETS[p0]!, PRESETS[p1]!, { seed, board: DEFAULT_BOARD });
  let state = createGame(config);
  let steps = 0;
  while (state.phase !== 'gameOver' && steps < STEP_CAP) {
    state = reduce(state, chooseCommand(state)).state;
    steps++;
  }
  return state;
}

describe('preset warband matches (engine + content + ai)', () => {
  // Every ordered pairing of distinct presets, over a couple of seeds each.
  const pairs = PRESET_IDS.flatMap((a) => PRESET_IDS.filter((b) => b !== a).map((b) => [a, b]));

  it.each(pairs)('%s vs %s terminates with a decisive winner', (p0, p1) => {
    for (const seed of [1, 2, 3]) {
      const final = playPresetMatch(p0, p1, seed);
      expect(final.phase).toBe('gameOver');
      expect(final.winner === 0 || final.winner === 1).toBe(true);
      const alive0 = final.units.filter((u) => u.owner === 0 && !u.dead).length;
      const alive1 = final.units.filter((u) => u.owner === 1 && !u.dead).length;
      expect(alive0 === 0 || alive1 === 0).toBe(true);
    }
  });

  it('replays a preset match identically for a fixed seed', () => {
    const a = playPresetMatch('iron-wardens', 'ashfang-raiders', 99);
    const b = playPresetMatch('iron-wardens', 'ashfang-raiders', 99);
    expect(a).toEqual(b);
  });
});
