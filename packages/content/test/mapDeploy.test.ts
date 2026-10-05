import { describe, expect, it } from 'vitest';
import { createGame, getLegalCommands, vecKey, type Vec } from '@fansong/engine';
import { buildMatch, DEFAULT_BOARD, DEFAULT_MAP, layOutInZone } from '../src/deploy.js';
import { flatMap, mapToBoard, type MapDef } from '../src/map.js';
import { validateMap } from '../src/mapValidate.js';
import { PRESET_IDS, PRESETS } from '../src/presets.js';
import type { WarbandUnit } from '../src/warband.js';

const units = (n: number): WarbandUnit[] =>
  Array.from({ length: n }, (_, i) => ({ name: `U${i}`, quality: 4, combat: 2 }));

const row = (y: number, width: number): Vec[] => Array.from({ length: width }, (_, x) => ({ x, y }));

describe('mapToBoard', () => {
  it('gives a flat map exactly the legacy board shape (no terrain key)', () => {
    expect(mapToBoard(DEFAULT_MAP)).toEqual({ width: 12, height: 10 });
    expect('terrain' in mapToBoard(DEFAULT_MAP)).toBe(false);
  });

  it('carries only non-default hexes as sparse terrain', () => {
    const map = flatMap(8, 8);
    map.hexes[0 * 8 + 3] = { elevation: 2 };
    map.hexes[2 * 8 + 4] = { elevation: 0, feature: 'rock' };
    map.hexes[5 * 8 + 1] = { elevation: 1, feature: 'forest' };
    expect(mapToBoard(map)).toEqual({
      width: 8,
      height: 8,
      terrain: {
        '1,5': { elevation: 1, feature: 'forest' },
        '3,0': { elevation: 2 },
        '4,2': { feature: 'rock' },
      },
    });
  });
});

describe('DEFAULT_MAP', () => {
  it('is a valid map', () => {
    expect(validateMap(DEFAULT_MAP)).toEqual({ ok: true, errors: [] });
  });

  it('reproduces the legacy flat-board config exactly for every preset pairing', () => {
    for (const a of PRESET_IDS) {
      for (const b of PRESET_IDS) {
        const opts = { seed: 42, initiativeLeader: 1 as const };
        const legacy = buildMatch(PRESETS[a]!, PRESETS[b]!, { ...opts, board: DEFAULT_BOARD });
        const mapped = buildMatch(PRESETS[a]!, PRESETS[b]!, { ...opts, map: DEFAULT_MAP });
        expect(mapped).toEqual(legacy);
        expect(JSON.stringify(createGame(mapped))).toBe(JSON.stringify(createGame(legacy)));
      }
    }
  });

  it('matches legacy overflow into the second column for a full warband', () => {
    const legacy = buildMatch({ name: 'A', units: units(12) }, { name: 'B', units: units(12) }, {
      seed: 1,
      board: DEFAULT_BOARD,
    });
    const mapped = buildMatch({ name: 'A', units: units(12) }, { name: 'B', units: units(12) }, {
      seed: 1,
      map: DEFAULT_MAP,
    });
    expect(mapped).toEqual(legacy);
  });

  it('buildMatch defaults to DEFAULT_BOARD when neither board nor map is given', () => {
    const config = buildMatch(PRESETS['iron-wardens-medium']!, PRESETS['night-haunt-medium']!, { seed: 3 });
    expect(config.board).toEqual({ width: 12, height: 10 });
  });
});

describe('layOutInZone', () => {
  it('keeps every model inside its zone with no collisions', () => {
    const map = DEFAULT_MAP;
    for (const owner of [0, 1] as const) {
      const zone = new Set(map.deployZones[owner].map(vecKey));
      const specs = layOutInZone(units(12), owner, map);
      expect(new Set(specs.map((s) => vecKey(s.pos))).size).toBe(12);
      for (const s of specs) expect(zone.has(vecKey(s.pos))).toBe(true);
    }
  });

  it('fills the rank farthest from the enemy first on top/bottom zones', () => {
    const width = 8;
    const map: MapDef = {
      ...flatMap(width, 10),
      deployZones: [
        [...row(0, width), ...row(1, width)],
        [...row(9, width), ...row(8, width)],
      ],
    };
    const p0 = layOutInZone(units(10), 0, map);
    const p1 = layOutInZone(units(10), 1, map);
    // The back row holds 8; the remaining 2 step forward, centred.
    expect(p0.filter((s) => s.pos.y === 0)).toHaveLength(8);
    expect(p0.filter((s) => s.pos.y === 1).map((s) => s.pos.x)).toEqual([3, 4]);
    expect(p1.filter((s) => s.pos.y === 9)).toHaveLength(8);
    expect(p1.filter((s) => s.pos.y === 8).map((s) => s.pos.x)).toEqual([3, 4]);
  });

  it('spills a warband too big for its zone onto the nearest open hexes', () => {
    const map: MapDef = { ...flatMap(8, 8), deployZones: [[{ x: 0, y: 0 }], [{ x: 7, y: 7 }]] };
    map.hexes[1] = { elevation: 0, feature: 'rock' }; // (1,0), next to the zone
    const specs = layOutInZone(units(4), 0, map);
    expect(specs[0]!.pos).toEqual({ x: 0, y: 0 });
    const spill = specs.slice(1).map((s) => s.pos);
    // (0,0)'s open neighbours are (0,1) and (1,1); the third model walks one hex further, round the rock.
    expect(spill.slice(0, 2)).toEqual(expect.arrayContaining([{ x: 0, y: 1 }, { x: 1, y: 1 }]));
    expect(Math.min(...spill.slice(2).map((v) => Math.max(v.x, v.y)))).toBe(2);
    expect(new Set(specs.map((s) => vecKey(s.pos))).size).toBe(4);
  });

  it('keeps each side’s overflow off the other side’s models in a match', () => {
    // Two 12-hex zones face each other across the middle; 20-model armies overflow both.
    const column = (x: number) => Array.from({ length: 10 }, (_, y) => ({ x, y }));
    const map: MapDef = {
      ...flatMap(12, 10),
      deployZones: [
        [...column(5), { x: 4, y: 0 }, { x: 4, y: 1 }],
        [...column(6), { x: 7, y: 8 }, { x: 7, y: 9 }],
      ],
    };
    const army = { name: 'Horde', units: units(20) };
    const config = buildMatch(army, army, { seed: 1, map });
    const all = config.warbands.flat().map((s) => vecKey(s.pos));
    expect(all).toHaveLength(40);
    expect(new Set(all).size).toBe(40);
    // Each zone is filled before anyone spills out of it.
    map.deployZones.forEach((zone, p) =>
      expect(config.warbands[p]!.map((s) => s.pos)).toEqual(expect.arrayContaining(zone)),
    );
    createGame(config);
  });

  it('throws only when the whole board has no room', () => {
    const map: MapDef = { ...flatMap(2, 2), deployZones: [[{ x: 0, y: 0 }], [{ x: 1, y: 1 }]] };
    expect(() => layOutInZone(units(4), 0, map)).toThrow(/room for only 3 of player 0's 4 models/);
  });
});

describe('buildMatch with a map', () => {
  it('plays on the map terrain and deploys into its zones', () => {
    const map = flatMap(12, 12, 'ridge', 'Ridge');
    map.hexes[5 * 12 + 5] = { elevation: 0, feature: 'rock' };
    map.hexes[6 * 12 + 6] = { elevation: 2 };
    const config = buildMatch(PRESETS['iron-wardens-medium']!, PRESETS['night-haunt-medium']!, { seed: 9, map });
    expect(config.board).toEqual({
      width: 12,
      height: 12,
      terrain: { '5,5': { feature: 'rock' }, '6,6': { elevation: 2 } },
    });
    const state = createGame(config);
    expect(state.board.terrain).toEqual(config.board.terrain);
    const zones = map.deployZones.map((z) => new Set(z.map(vecKey)));
    for (const u of state.units) expect(zones[u.owner]!.has(vecKey(u.pos))).toBe(true);
    expect(getLegalCommands(state).length).toBeGreaterThan(0);
  });

  it('ignores `board` when a map is given', () => {
    const config = buildMatch(PRESETS['iron-wardens-medium']!, PRESETS['night-haunt-medium']!, {
      seed: 9,
      board: { width: 20, height: 20 },
      map: flatMap(10, 8),
    });
    expect(config.board).toEqual({ width: 10, height: 8 });
  });

  it('rejects an invalid map', () => {
    const map = flatMap(12, 12);
    map.hexes[0] = { elevation: 0, feature: 'rock' }; // (0,0) is in player 0's deploy zone
    expect(() =>
      buildMatch(PRESETS['iron-wardens-medium']!, PRESETS['night-haunt-medium']!, { seed: 1, map }),
    ).toThrow(/invalid/);
  });
});
