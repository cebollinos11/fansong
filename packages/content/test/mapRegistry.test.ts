import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../src/deploy.js';
import { flatMap, mapToJson, parseMap } from '../src/map.js';
import { DEFAULT_MAP_ID, getMap, listMaps } from '../src/mapRegistry.js';
import { validateMap } from '../src/mapValidate.js';

const MAPS_DIR = fileURLToPath(new URL('../maps/', import.meta.url));
const jsonFiles = readdirSync(MAPS_DIR).filter((f) => f.endsWith('.json'));

describe('built-in map registry', () => {
  it('registers every JSON file in maps/, each named after its id', () => {
    const ids = listMaps().map((m) => m.id);
    expect([...ids].sort()).toEqual(jsonFiles.map((f) => f.replace(/\.json$/, '')).sort());
    for (const file of jsonFiles) {
      const map = parseMap(JSON.parse(readFileSync(MAPS_DIR + file, 'utf8')));
      expect(`${map.id}.json`).toBe(file);
      expect(getMap(map.id)).toEqual(map);
    }
  });

  it('has unique ids and only valid maps', () => {
    const ids = listMaps().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const map of listMaps()) expect(validateMap(map)).toEqual({ ok: true, errors: [] });
  });

  it('lists the default map first, identical to DEFAULT_MAP', () => {
    expect(listMaps()[0]?.id).toBe(DEFAULT_MAP_ID);
    expect(getMap(DEFAULT_MAP_ID)).toEqual(DEFAULT_MAP);
  });

  it('returns undefined for an unknown id', () => {
    expect(getMap('no-such-map')).toBeUndefined();
  });

  it('stores map files in the canonical mapToJson format', () => {
    for (const file of jsonFiles) {
      const text = readFileSync(MAPS_DIR + file, 'utf8').replace(/\r\n/g, '\n');
      expect(mapToJson(parseMap(JSON.parse(text)))).toBe(text);
    }
  });
});

describe('mapToJson', () => {
  it('round-trips terrain, zones and every objective kind', () => {
    const map = flatMap(6, 6, 'round-trip', 'Round "Trip"');
    map.hexes[7] = { elevation: 2, feature: 'forest' };
    map.hexes[14] = { elevation: 0, feature: 'rock' };
    map.objectives = {
      flags: [{ x: 0, y: 0 }, { x: 5, y: 5 }],
      hill: [{ x: 3, y: 3 }],
      conquest: [[{ x: 2, y: 1 }], [{ x: 3, y: 2 }], [{ x: 2, y: 4 }]],
    };
    const text = mapToJson(map);
    expect(parseMap(JSON.parse(text))).toEqual(map);
    // One line per map row.
    expect(text.split('\n').filter((l) => l.trimStart().startsWith('{"elevation"'))).toHaveLength(6);
  });

  it('writes objective keys in schema order whatever the insertion order', () => {
    const map = flatMap(4, 3, 'order', 'Order');
    map.objectives = { hill: [{ x: 2, y: 1 }], flags: [{ x: 0, y: 0 }, { x: 3, y: 2 }] };
    const text = mapToJson(map);
    expect(text.indexOf('"flags"')).toBeLessThan(text.indexOf('"hill"'));
    expect(mapToJson(parseMap(JSON.parse(text)))).toBe(text);
  });

  it('writes empty objectives compactly', () => {
    expect(mapToJson(flatMap(6, 6))).toContain('"objectives": {}\n}');
  });
});
