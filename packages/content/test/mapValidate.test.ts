import { describe, expect, it } from 'vitest';
import { GAME_MODES, makeHexGrid, type Vec } from '@fansong/engine';
import type { MapDef } from '../src/map.js';
import { MAP_LIMITS, supportedModes, validateMap } from '../src/mapValidate.js';

const column = (x: number, height: number): Vec[] =>
  Array.from({ length: height }, (_, y) => ({ x, y }));

/** A valid 12×12 flat map: each player deploys on its two edge columns. */
function baseMap(): MapDef {
  const width = 12;
  const height = 12;
  return {
    id: 'valid-map',
    name: 'Valid Map',
    width,
    height,
    hexes: Array.from({ length: width * height }, () => ({ elevation: 0 })),
    deployZones: [
      [...column(0, height), ...column(1, height)],
      [...column(10, height), ...column(11, height)],
    ],
    objectives: {},
  };
}

function setHex(map: MapDef, v: Vec, hex: MapDef['hexes'][number]) {
  map.hexes[v.y * map.width + v.x] = hex;
}

function withAllObjectives(): MapDef {
  const map = baseMap();
  map.objectives = {
    flags: [{ x: 0, y: 5 }, { x: 11, y: 6 }],
    hill: [{ x: 5, y: 5 }, { x: 6, y: 5 }],
    conquest: [[{ x: 5, y: 1 }], [{ x: 5, y: 6 }], [{ x: 6, y: 10 }]],
  };
  return map;
}

describe('validateMap', () => {
  it('accepts a valid flat map', () => {
    expect(validateMap(baseMap())).toEqual({ ok: true, errors: [] });
  });

  it('accepts a map with every objective, for every mode', () => {
    const map = withAllObjectives();
    for (const mode of GAME_MODES) expect(validateMap(map, mode).errors).toEqual([]);
  });

  it('enforces size limits', () => {
    const small = baseMap();
    small.width = MAP_LIMITS.minWidth - 1;
    expect(validateMap(small).errors.join()).toMatch(/width 5 outside 6–24/);

    const tall = baseMap();
    tall.height = MAP_LIMITS.maxHeight + 1;
    expect(validateMap(tall).errors.join()).toMatch(/height 25 outside/);
  });

  it('requires exactly width × height hexes', () => {
    const map = baseMap();
    map.hexes.pop();
    expect(validateMap(map)).toEqual({ ok: false, errors: ['expected 144 hexes, got 143'] });
  });

  it('rejects deploy hexes on rocks/buildings but allows forest and elevation', () => {
    const map = baseMap();
    setHex(map, { x: 0, y: 0 }, { elevation: 2, feature: 'forest' });
    setHex(map, { x: 1, y: 0 }, { elevation: 3 });
    expect(validateMap(map).ok).toBe(true);

    setHex(map, { x: 0, y: 1 }, { elevation: 0, feature: 'rock' });
    setHex(map, { x: 11, y: 1 }, { elevation: 0, feature: 'building' });
    const { errors } = validateMap(map);
    expect(errors).toContain('player 0 deploy zone: hex (0,1) is impassable');
    expect(errors).toContain('player 1 deploy zone: hex (11,1) is impassable');
  });

  it('requires room for a full warband in each deploy zone', () => {
    const map = baseMap();
    map.deployZones[1] = column(11, MAP_LIMITS.minDeployHexes - 1);
    expect(validateMap(map).errors).toContain(
      `player 1 deploy zone needs at least ${MAP_LIMITS.minDeployHexes} hexes, has ${MAP_LIMITS.minDeployHexes - 1}`,
    );
  });

  it('rejects off-map, duplicate and shared deploy hexes', () => {
    const map = baseMap();
    map.deployZones[0].push({ x: 0, y: 12 }, { x: 0, y: 0 });
    map.deployZones[1].push({ x: 1, y: 3 });
    const { errors } = validateMap(map);
    expect(errors).toContain('player 0 deploy zone: hex (0,12) is off the map');
    expect(errors).toContain('player 0 deploy zone: duplicate hex (0,0)');
    expect(errors).toContain('deploy zones overlap at 1,3');
  });

  it('rejects deploy zones cut off from each other', () => {
    const map = baseMap();
    // A full-height rock wall down column 5 splits the board in two.
    for (const v of column(5, map.height)) setHex(map, v, { elevation: 0, feature: 'rock' });
    expect(validateMap(map).errors).toEqual(['deploy hexes are not all connected by passable ground']);

    // A forest gap in the wall is walkable again.
    setHex(map, { x: 5, y: 7 }, { elevation: 1, feature: 'forest' });
    expect(validateMap(map).ok).toBe(true);
  });

  it('rejects a deploy hex walled into its own pocket', () => {
    const map = baseMap();
    // (0,0)'s only in-bounds neighbours (odd-q) are (1,0) and (0,1): build over both.
    const walls = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
    for (const v of walls) setHex(map, v, { elevation: 0, feature: 'building' });
    map.deployZones[0] = map.deployZones[0].filter((v) => !walls.some((w) => w.x === v.x && w.y === v.y));
    expect(validateMap(map).errors).toEqual(['deploy hexes are not all connected by passable ground']);
  });

  it('checks flag bases: in bounds, passable, distinct', () => {
    const map = baseMap();
    setHex(map, { x: 6, y: 6 }, { elevation: 0, feature: 'rock' });
    map.objectives.flags = [{ x: 6, y: 6 }, { x: 6, y: 6 }];
    const { errors } = validateMap(map);
    expect(errors).toContain('player 0 flag base: hex (6,6) is impassable');
    expect(errors).toContain('flag bases share a hex');

    map.objectives.flags = [{ x: 3, y: 3 }, { x: 30, y: 3 }];
    expect(validateMap(map).errors).toEqual(['player 1 flag base: hex (30,3) is off the map']);
  });

  it('checks the hill zone: non-empty, passable, clear of deploy zones', () => {
    const map = baseMap();
    map.objectives.hill = [];
    expect(validateMap(map).errors).toEqual(['hill zone needs at least 1 hex, has 0']);

    map.objectives.hill = [{ x: 1, y: 4 }, { x: 5, y: 5 }];
    setHex(map, { x: 5, y: 5 }, { elevation: 0, feature: 'building' });
    const { errors } = validateMap(map);
    expect(errors).toContain('hill zone: hex (5,5) is impassable');
    expect(errors).toContain('hill zone overlaps a deploy zone at 1,4');
  });

  it('checks conquest zones are disjoint', () => {
    const map = baseMap();
    map.objectives.conquest = [[{ x: 5, y: 1 }], [{ x: 5, y: 6 }], [{ x: 5, y: 1 }]];
    expect(validateMap(map).errors).toEqual(['conquest zones 1 and 3 overlap at 5,1']);
  });

  /** Ring hex `v` with rocks so nothing can walk onto it. */
  const wallOff = (map: MapDef, v: Vec) => {
    for (const n of makeHexGrid({ width: map.width, height: map.height, blocked: [] }).neighbors(v))
      setHex(map, n, { elevation: 0, feature: 'rock' });
  };

  it('rejects a flag base no unit can walk to', () => {
    const map = withAllObjectives();
    map.objectives.flags = [{ x: 4, y: 3 }, { x: 7, y: 8 }];
    wallOff(map, { x: 4, y: 3 });
    expect(validateMap(map).errors).toEqual(['player 0 flag base: (4,3) unreachable from the deploy zones']);
    expect(supportedModes(map)).toEqual([]);
  });

  it('rejects hill and conquest hexes no unit can walk to, naming just those hexes', () => {
    const map = withAllObjectives();
    map.objectives.hill = [{ x: 5, y: 5 }, { x: 8, y: 3 }];
    wallOff(map, { x: 8, y: 3 });
    wallOff(map, { x: 6, y: 10 });
    expect(validateMap(map).errors).toEqual([
      'hill zone: (8,3) unreachable from the deploy zones',
      'conquest zone 3: (6,10) unreachable from the deploy zones',
    ]);
  });

  it('an impassable objective hex is reported as impassable, not also as unreachable', () => {
    const map = withAllObjectives();
    setHex(map, { x: 5, y: 1 }, { elevation: 0, feature: 'rock' });
    expect(validateMap(map).errors).toEqual(['conquest zone 1: hex (5,1) is impassable']);
  });

  it('reports missing objectives for the requested mode', () => {
    const map = baseMap();
    expect(validateMap(map, 'annihilation').ok).toBe(true);
    expect(validateMap(map, 'kill-the-king').ok).toBe(true);
    expect(validateMap(map, 'capture-the-flag').errors).toEqual(['capture-the-flag needs flag bases']);
    expect(validateMap(map, 'king-of-the-hill').errors).toEqual(['king-of-the-hill needs a hill zone']);
    expect(validateMap(map, 'conquest').errors).toEqual(['conquest needs three conquest zones']);
  });

  it('reports every problem at once', () => {
    const map = baseMap();
    map.deployZones = [[], []];
    map.objectives.flags = [{ x: 3, y: 3 }, { x: 3, y: 3 }];
    expect(validateMap(map, 'conquest').errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('supportedModes', () => {
  it('a bare valid map hosts annihilation and kill-the-king', () => {
    expect(supportedModes(baseMap())).toEqual(['annihilation', 'kill-the-king']);
  });

  it('each objective unlocks its mode', () => {
    expect(supportedModes(withAllObjectives())).toEqual([...GAME_MODES]);

    const ctf = baseMap();
    ctf.objectives.flags = [{ x: 0, y: 5 }, { x: 11, y: 6 }];
    expect(supportedModes(ctf)).toContain('capture-the-flag');
    expect(supportedModes(ctf)).not.toContain('conquest');
  });

  it('an invalid map supports nothing', () => {
    const map = withAllObjectives();
    map.objectives.hill = [{ x: 0, y: 0 }];
    expect(supportedModes(map)).toEqual([]);
  });
});
