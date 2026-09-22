import { describe, expect, it } from 'vitest';
import { mapDefSchema, mapHexAt, parseMap, type MapDef } from '../src/map.js';

function flatMap(width = 4, height = 3): MapDef {
  return {
    id: 'test-map',
    name: 'Test Map',
    width,
    height,
    hexes: Array.from({ length: width * height }, () => ({ elevation: 0 })),
    deployZones: [[{ x: 0, y: 1 }], [{ x: width - 1, y: 1 }]],
    objectives: {},
  };
}

describe('mapDefSchema', () => {
  it('accepts a minimal flat map and round-trips through JSON', () => {
    const map = flatMap();
    expect(parseMap(JSON.parse(JSON.stringify(map)))).toEqual(map);
  });

  it('accepts features, elevation and every objective kind', () => {
    const map = flatMap();
    map.hexes[0] = { elevation: 3, feature: 'rock' };
    map.hexes[1] = { elevation: 1, feature: 'forest' };
    map.hexes[2] = { elevation: 0, feature: 'building' };
    map.objectives = {
      flags: [{ x: 0, y: 0 }, { x: 3, y: 2 }],
      hill: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      conquest: [[{ x: 0, y: 2 }], [{ x: 1, y: 1 }], [{ x: 3, y: 0 }]],
    };
    expect(parseMap(map)).toEqual(map);
  });

  it.each([
    ['elevation above max', (m: MapDef) => (m.hexes[0] = { elevation: 4 })],
    ['negative elevation', (m: MapDef) => (m.hexes[0] = { elevation: -1 })],
    ['fractional elevation', (m: MapDef) => (m.hexes[0] = { elevation: 1.5 })],
    ['unknown feature', (m: MapDef) => ((m.hexes[0] as unknown as { feature: string }).feature = 'lava')],
    ['stray hex key', (m: MapDef) => ((m.hexes[0] as unknown as { blocked: boolean }).blocked = true)],
    ['bad id', (m: MapDef) => (m.id = 'Not A Slug')],
    ['blank name', (m: MapDef) => (m.name = '   ')],
    ['zero width', (m: MapDef) => (m.width = 0)],
    ['negative coordinate', (m: MapDef) => (m.deployZones[0] = [{ x: -1, y: 0 }])],
    ['one deploy zone', (m: MapDef) => ((m as unknown as { deployZones: unknown }).deployZones = [[]])],
    ['two conquest zones', (m: MapDef) => ((m.objectives as unknown as { conquest: unknown }).conquest = [[], []])],
    ['unknown objective', (m: MapDef) => ((m.objectives as unknown as { bomb: unknown }).bomb = [])],
  ])('rejects %s', (_label, mutate) => {
    const map = flatMap();
    mutate(map);
    expect(mapDefSchema.safeParse(map).success).toBe(false);
    expect(() => parseMap(map)).toThrow(/invalid map/);
  });

  it('names the offending path in parse errors', () => {
    const map = flatMap();
    map.hexes[5] = { elevation: 9 };
    expect(() => parseMap(map)).toThrow(/hexes\.5\.elevation/);
  });
});

describe('mapHexAt', () => {
  it('indexes row-major and returns undefined off the map', () => {
    const map = flatMap(4, 3);
    map.hexes[2 * 4 + 1] = { elevation: 2, feature: 'forest' };
    expect(mapHexAt(map, { x: 1, y: 2 })).toEqual({ elevation: 2, feature: 'forest' });
    expect(mapHexAt(map, { x: 0, y: 0 })).toEqual({ elevation: 0 });
    expect(mapHexAt(map, { x: 4, y: 0 })).toBeUndefined();
    expect(mapHexAt(map, { x: 0, y: -1 })).toBeUndefined();
  });
});
