import { createGame } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { buildMatch, DEFAULT_MAP } from '../src/deploy.js';
import { mapToBoard, type MapDef } from '../src/map.js';
import { configFromSetup, createMatchFromPresets, DEFAULT_SETUP, resolveMap } from '../src/match.js';
import { DEFAULT_MAP_ID, getMap, listMaps } from '../src/mapRegistry.js';
import { PRESETS } from '../src/presets.js';

describe('MatchSetup.mapId', () => {
  it('omitted: the legacy flat board, unchanged', () => {
    const config = configFromSetup(DEFAULT_SETUP);
    expect(config).toEqual(
      buildMatch(PRESETS[DEFAULT_SETUP.presets[0]]!, PRESETS[DEFAULT_SETUP.presets[1]]!, { seed: DEFAULT_SETUP.seed }),
    );
    expect('terrain' in config.board).toBe(false);
  });

  it('the default map id yields exactly the legacy game state', () => {
    const legacy = createMatchFromPresets(DEFAULT_SETUP);
    const mapped = createMatchFromPresets({ ...DEFAULT_SETUP, mapId: DEFAULT_MAP_ID });
    expect(JSON.stringify(mapped)).toBe(JSON.stringify(legacy));
  });

  it.each(listMaps().map((m) => m.id))('map %s: board carries its terrain, units deploy in its zones', (id) => {
    const map = getMap(id)!;
    const config = configFromSetup({ ...DEFAULT_SETUP, mapId: id });
    expect(config.board).toEqual(mapToBoard(map));
    for (const owner of [0, 1] as const) {
      const zone = new Set(map.deployZones[owner].map((v) => `${v.x},${v.y}`));
      for (const spec of config.warbands[owner]) expect(zone.has(`${spec.pos.x},${spec.pos.y}`)).toBe(true);
    }
    expect(() => createGame(config)).not.toThrow();
  });

  it('throws on an unknown map id', () => {
    expect(() => configFromSetup({ ...DEFAULT_SETUP, mapId: 'atlantis' })).toThrow(/unknown map "atlantis"/);
  });

  it('a custom lookup resolves maps the registry does not know', () => {
    const custom: MapDef = { ...DEFAULT_MAP, id: 'my-map', name: 'My Map' };
    const lookup = (id: string) => (id === 'my-map' ? custom : getMap(id));
    expect(resolveMap('my-map', lookup)).toBe(custom);
    const config = configFromSetup({ ...DEFAULT_SETUP, mapId: 'my-map' }, undefined, lookup);
    expect(config).toEqual(configFromSetup(DEFAULT_SETUP));
    expect(() => resolveMap('my-map')).toThrow();
  });
});
