import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeHexGrid, GAME_MODES, type Vec } from '@fansong/engine';
import { mapHexAt, type MapDef } from '../src/map.js';
import { getMap, listMaps } from '../src/mapRegistry.js';
import { supportedModes } from '../src/mapValidate.js';

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
        // Castle is a siege: its terrain is symmetric, but by design not who deploys where.
        const lopsided = map.id === 'castle';
        if (!lopsided) expect(sortVecs(map.deployZones[1])).toEqual(sortVecs(map.deployZones[0].map((v) => mirror(map, v))));
        const { flags, hill, conquest } = map.objectives;
        if (flags && !lopsided) expect(flags[1]).toEqual(mirror(map, flags[0]));
        if (hill) expect(sortVecs(hill.map((v) => mirror(map, v)))).toEqual(sortVecs(hill));
        if (conquest) {
          // Zone 2 is its own mirror image; zones 1 and 3 mirror each other.
          const mirrored = (zone: Vec[]) => sortVecs(zone.map((v) => mirror(map, v)));
          expect(mirrored(conquest[1])).toEqual(sortVecs(conquest[1]));
          expect(mirrored(conquest[0])).toEqual(sortVecs(conquest[2]));
        }
      });
    });
  }
});

describe('every built-in map × every mode', () => {
  it('every built-in map hosts every mode', () => {
    for (const map of listMaps()) expect(supportedModes(map)).toEqual(GAME_MODES);
  });

  // The self-play games live in one file per mode so they run in parallel; a new mode needs its own.
  it('every mode has a self-play suite', () => {
    const suites = readdirSync(new URL('./selfPlay', import.meta.url)).filter((f) => f.endsWith('.test.ts'));
    expect(suites.sort()).toEqual(GAME_MODES.map((mode) => `${mode}.test.ts`).sort());
  });
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

  it('The Stone Crown is a 40×40 showcase of every elevation and feature, hosting every mode', () => {
    const map = getMap('stone-crown')!;
    expect([map.width, map.height]).toEqual([40, 40]);
    for (const e of [0, 1, 2, 3]) expect(count(map, (h) => h.elevation === e)).toBeGreaterThan(100);
    expect(count(map, (h) => h.feature === 'rock')).toBeGreaterThanOrEqual(60);
    expect(count(map, (h) => h.feature === 'building')).toBeGreaterThanOrEqual(30);
    expect(count(map, (h) => h.feature === 'forest')).toBeGreaterThanOrEqual(200);
    // The Crown's summit is level 3, and is both the hill and the middle conquest zone.
    for (const v of map.objectives.hill!) expect(mapHexAt(map, v)?.elevation).toBe(3);
    expect(sortVecs(map.objectives.conquest![1])).toEqual(sortVecs(map.objectives.hill!));
    // Each flag stands in its keep's level-3 courtyard, nearer its own deployment.
    const grid = makeHexGrid({ width: map.width, height: map.height, blocked: [] });
    const [home0] = map.objectives.flags!;
    expect(mapHexAt(map, home0)?.elevation).toBe(3);
    const nearest = (zone: Vec[]) => Math.min(...zone.map((v) => grid.distance(home0, v)));
    expect(nearest(map.deployZones[0])).toBeLessThan(nearest(map.deployZones[1]));
    expect(supportedModes(map)).toEqual(GAME_MODES);
  });

  it('Castle puts the defenders in a walled, raised courtyard ringed by the attackers’ camps', () => {
    const map = getMap('castle')!;
    const grid = makeHexGrid({ width: map.width, height: map.height, blocked: [] });
    const [defenders, attackers] = map.deployZones;
    // The defenders deploy in the middle of the board, above everything but the keep.
    for (const v of defenders) expect(mapHexAt(map, v)?.elevation).toBe(2);
    for (const v of map.objectives.hill!) expect(mapHexAt(map, v)?.elevation).toBe(3);
    expect(sortVecs(map.objectives.conquest![1])).toEqual(sortVecs(map.objectives.hill!));
    // The attackers surround them: a camp in every quadrant of the board.
    const quadrants = new Set(attackers.map((v) => `${v.x < map.width / 2},${v.y < map.height / 2}`));
    expect(quadrants.size).toBe(4);
    // A wall of buildings stands between the two, broken by gates.
    const wall = map.hexes
      .map((h, i) => ({ h, v: { x: i % map.width, y: Math.floor(i / map.width) } }))
      .filter(({ h, v }) => h.feature === 'building' && defenders.some((d) => grid.distance(d, v) === 1));
    expect(wall.length).toBeGreaterThanOrEqual(12);
    // Each flag is nearer its own side's deployment.
    const nearest = (zone: Vec[], v: Vec) => Math.min(...zone.map((u) => grid.distance(u, v)));
    map.objectives.flags!.forEach((f, p) => expect(nearest(map.deployZones[p]!, f)).toBeLessThan(nearest(map.deployZones[1 - p]!, f)));
    expect(supportedModes(map)).toEqual(GAME_MODES);
  });

  it('Warpaths is a long map of three open roads through the wilds, with a conquest zone on each', () => {
    const map = getMap('warpaths')!;
    expect([map.width, map.height]).toEqual([40, 28]);
    // The north, middle and south roads run clear between the camps, bar a watchtower each side.
    for (const y of [3, 13, 14, 24]) {
      const blocked = Array.from({ length: 20 }, (_, i) => mapHexAt(map, { x: 10 + i, y })!).filter((h) => h.feature !== undefined);
      expect(blocked.length).toBeLessThanOrEqual(2);
      for (const h of blocked) expect(h.feature).toBe('building');
    }
    // One zone where each road fords the riverbed; the raised middle ford is also the hill.
    const [north, middle, south] = map.objectives.conquest!;
    expect([north.length, middle.length, south.length]).toEqual([6, 8, 6]);
    for (const v of north) expect(v.y).toBeLessThanOrEqual(4);
    for (const v of south) expect(v.y).toBeGreaterThanOrEqual(23);
    for (const v of middle) expect(mapHexAt(map, v)?.elevation).toBe(1);
    expect(sortVecs(map.objectives.hill!)).toEqual(sortVecs(middle));
    // The wilds between the roads are thick with forest and rock.
    expect(count(map, (h) => h.feature === 'forest')).toBeGreaterThanOrEqual(200);
    expect(count(map, (h) => h.feature === 'rock')).toBeGreaterThanOrEqual(200);
    expect(supportedModes(map)).toEqual(GAME_MODES);
  });
});
