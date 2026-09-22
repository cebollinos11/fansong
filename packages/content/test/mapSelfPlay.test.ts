import { describe, expect, it } from 'vitest';
import { chooseCommand } from '@fansong/ai';
import {
  createGame,
  getLegalCommands,
  makeHexGrid,
  reduce,
  type GameEvent,
  type GameMode,
  type GameState,
  type Vec,
} from '@fansong/engine';
import { buildMatch } from '../src/deploy.js';
import { mapHexAt, type MapDef } from '../src/map.js';
import { getMap, listMaps } from '../src/mapRegistry.js';
import { supportedModes } from '../src/mapValidate.js';
import { PRESET_IDS, getPreset } from '../src/presets.js';

const STEP_CAP = 20_000;

/** Play a full AI-vs-AI game on `map`, checking terrain invariants each step. */
function playOn(
  map: MapDef,
  seed: number,
  presets: [string, string],
  mode?: GameMode,
  events: GameEvent[] = [],
): GameState {
  let state = createGame(buildMatch(getPreset(presets[0])!, getPreset(presets[1])!, { seed, map, mode }));
  const board = makeHexGrid(state.board);
  let steps = 0;
  while (state.phase !== 'gameOver' && steps < STEP_CAP) {
    const command = chooseCommand(state);
    expect(getLegalCommands(state)).toContainEqual(command);
    const result = reduce(state, command);
    state = result.state;
    events.push(...result.events);
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
        const { flags, hill, conquest } = map.objectives;
        if (flags) expect(flags[1]).toEqual(mirror(map, flags[0]));
        if (hill) expect(sortVecs(hill.map((v) => mirror(map, v)))).toEqual(sortVecs(hill));
        if (conquest) {
          // Zone 2 is its own mirror image; zones 1 and 3 mirror each other.
          const mirrored = (zone: Vec[]) => sortVecs(zone.map((v) => mirror(map, v)));
          expect(mirrored(conquest[1])).toEqual(sortVecs(conquest[1]));
          expect(mirrored(conquest[0])).toEqual(sortVecs(conquest[2]));
        }
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

describe('AI in the zone modes', () => {
  const zoneModes = ['king-of-the-hill', 'conquest'] as const;
  for (const map of listMaps()) {
    for (const mode of zoneModes) {
      if (!supportedModes(map).includes(mode)) continue;
      it(`${map.id}: ${mode} games complete within the round cap, and the AI actually scores`, () => {
        let scored = 0;
        for (let seed = 1; seed <= 3; seed++) {
          const events: GameEvent[] = [];
          const presets: [string, string] = [PRESET_IDS[seed % PRESET_IDS.length]!, PRESET_IDS[(seed + 1) % PRESET_IDS.length]!];
          const final = playOn(map, seed, presets, mode, events);
          expect(final.phase).toBe('gameOver');
          expect(final.round).toBeLessThanOrEqual(12);
          expect(events.some((e) => e.type === 'GameOver')).toBe(true);
          scored += events.filter((e) => e.type === 'ScoreChanged').length;
        }
        // Zone-seeking AIs hold zones for a good share of the rounds.
        expect(scored).toBeGreaterThanOrEqual(6);
      });
    }
  }
});

describe('AI in capture-the-flag', () => {
  for (const map of listMaps()) {
    if (!supportedModes(map).includes('capture-the-flag')) continue;
    it(`${map.id}: games complete, and the AI goes for the flags`, () => {
      let pickups = 0;
      let captures = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const events: GameEvent[] = [];
        const presets: [string, string] = [PRESET_IDS[seed % PRESET_IDS.length]!, PRESET_IDS[(seed + 1) % PRESET_IDS.length]!];
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

  it('Ruined Village has building blocks, open streets and a raised market square', () => {
    const map = getMap('ruined-village')!;
    expect(count(map, (h) => h.feature === 'building')).toBeGreaterThanOrEqual(20);
    // The main street (rows 5–6) runs unobstructed from edge to edge.
    for (let x = 0; x < map.width; x++)
      for (const y of [5, 6]) expect(mapHexAt(map, { x, y })?.feature).toBeUndefined();
    for (const v of map.objectives.hill!) expect(mapHexAt(map, v)?.elevation).toBe(1);
    expect(supportedModes(map)).toEqual(expect.arrayContaining(['king-of-the-hill', 'capture-the-flag']));
  });

  it('Rocky Pass is split by a rock ridge crossed only at a few high-ground passes', () => {
    const map = getMap('rocky-pass')!;
    const passes: Vec[] = [];
    for (let y = 0; y < map.height; y++) {
      for (const x of [6, 7]) {
        const hex = mapHexAt(map, { x, y })!;
        if (hex.feature === undefined) passes.push({ x, y });
        else expect(hex.feature).toBe('rock');
      }
    }
    expect(passes.length).toBeLessThanOrEqual(8);
    for (const v of passes) expect(mapHexAt(map, v)?.elevation).toBe(2);
    for (const v of map.objectives.hill!) expect(passes).toContainEqual(v);
    expect(supportedModes(map)).toContain('king-of-the-hill');
  });

  it('Twin Towers puts each flag on its own level-3 plateau behind a rock wall', () => {
    const map = getMap('twin-towers')!;
    const grid = makeHexGrid({ width: map.width, height: map.height, blocked: [] });
    const [home0] = map.objectives.flags!;
    expect(mapHexAt(map, home0)?.elevation).toBe(3);
    // The flag's plateau (every hex within 1) is level 3 and open.
    for (const v of map.hexes.map((_, i) => ({ x: i % map.width, y: Math.floor(i / map.width) })))
      if (grid.distance(home0, v) <= 1) expect(mapHexAt(map, v)).toEqual({ elevation: 3 });
    // The flag is closer to its owner's deploy zone than to the enemy's.
    const nearest = (zone: Vec[]) => Math.min(...zone.map((v) => grid.distance(home0, v)));
    expect(nearest(map.deployZones[0])).toBeLessThan(nearest(map.deployZones[1]));
    expect(count(map, (h) => h.feature === 'rock')).toBeGreaterThanOrEqual(6);
    expect(supportedModes(map)).toContain('capture-the-flag');
  });

  it('Crossroads has open roads and three conquest zones along the north–south road', () => {
    const map = getMap('crossroads')!;
    for (let i = 0; i < map.width; i++) {
      for (const y of [5, 6]) expect(mapHexAt(map, { x: i, y })?.feature).toBeUndefined();
      for (const x of [6, 7]) if (i < map.height) expect(mapHexAt(map, { x, y: i })?.feature).toBeUndefined();
    }
    const [a, b, c] = map.objectives.conquest!;
    expect([a.length, b.length, c.length]).toEqual([8, 4, 8]);
    expect(sortVecs(map.objectives.hill!)).toEqual(sortVecs(b));
    expect(count(map, (h) => h.feature === 'building')).toBeGreaterThanOrEqual(10);
    expect(supportedModes(map)).toEqual(expect.arrayContaining(['conquest', 'king-of-the-hill']));
  });
});
