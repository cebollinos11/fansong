import { describe, expect, it } from 'vitest';
import { chooseCommand } from '@fansong/ai';
import { createGame, getLegalCommands, makeHexGrid, reduce, type GameState } from '@fansong/engine';
import { buildMatch } from '../src/deploy.js';
import { mapHexAt, type MapDef } from '../src/map.js';
import { getMap, listMaps } from '../src/mapRegistry.js';
import { supportedModes } from '../src/mapValidate.js';
import { PRESET_IDS, getPreset } from '../src/presets.js';

const STEP_CAP = 20_000;

/** Play a full AI-vs-AI annihilation game on `map`, checking terrain invariants each step. */
function playOn(map: MapDef, seed: number, presets: [string, string]): GameState {
  let state = createGame(buildMatch(getPreset(presets[0])!, getPreset(presets[1])!, { seed, map }));
  const board = makeHexGrid(state.board);
  let steps = 0;
  while (state.phase !== 'gameOver' && steps < STEP_CAP) {
    const command = chooseCommand(state);
    expect(getLegalCommands(state)).toContainEqual(command);
    state = reduce(state, command).state;
    steps++;
    // Nobody ever stands in a rock or building.
    for (const u of state.units) if (!u.dead) expect(board.isBlocked(u.pos)).toBe(false);
  }
  expect(steps).toBeLessThan(STEP_CAP);
  return state;
}

const mirror = (map: MapDef, v: { x: number; y: number }) => ({ x: map.width - 1 - v.x, y: map.height - 1 - v.y });
const sortVecs = <T extends { x: number; y: number }>(vs: T[]) => [...vs].sort((a, b) => a.y - b.y || a.x - b.x);

describe('built-in maps', () => {
  for (const map of listMaps()) {
    describe(map.id, () => {
      it('supports annihilation', () => {
        expect(supportedModes(map)).toContain('annihilation');
      });

      it('is point-symmetric, so neither side has the better ground', () => {
        for (let y = 0; y < map.height; y++)
          for (let x = 0; x < map.width; x++) expect(mapHexAt(map, mirror(map, { x, y }))).toEqual(mapHexAt(map, { x, y }));
        expect(sortVecs(map.deployZones[1])).toEqual(sortVecs(map.deployZones[0].map((v) => mirror(map, v))));
        const { flags, hill } = map.objectives;
        if (flags) expect(flags[1]).toEqual(mirror(map, flags[0]));
        if (hill) expect(sortVecs(hill.map((v) => mirror(map, v)))).toEqual(sortVecs(hill));
      });

      it('completes AI-vs-AI annihilation games with a winner', () => {
        for (let seed = 1; seed <= 4; seed++) {
          const presets: [string, string] = [
            PRESET_IDS[seed % PRESET_IDS.length]!,
            PRESET_IDS[(seed * 3 + 1) % PRESET_IDS.length]!,
          ];
          const final = playOn(map, seed, presets);
          expect(final.phase).toBe('gameOver');
          expect(final.winner === 0 || final.winner === 1).toBe(true);
          const alive = (p: 0 | 1) => final.units.some((u) => u.owner === p && !u.dead);
          expect(alive(0) && alive(1)).toBe(false);
        }
      });
    });
  }
});

describe('premade map character', () => {
  const count = (map: MapDef, pred: (h: MapDef['hexes'][number]) => boolean) => map.hexes.filter(pred).length;

  it('Rolling Hills is elevation-heavy with few features and a level-3 hilltop', () => {
    const map = getMap('rolling-hills')!;
    expect(count(map, (h) => h.elevation > 0)).toBeGreaterThan(map.hexes.length / 4);
    expect(count(map, (h) => h.feature !== undefined)).toBeLessThanOrEqual(12);
    expect(map.objectives.hill?.length).toBeGreaterThan(0);
    for (const v of map.objectives.hill!) expect(mapHexAt(map, v)?.elevation).toBe(3);
    expect(supportedModes(map)).toContain('king-of-the-hill');
  });

  it('Old Forest is dense woodland with capture-the-flag bases', () => {
    const map = getMap('old-forest')!;
    expect(count(map, (h) => h.feature === 'forest')).toBeGreaterThan(map.hexes.length / 3);
    expect(supportedModes(map)).toContain('capture-the-flag');
  });
});
