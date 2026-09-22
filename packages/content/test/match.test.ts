import { createGame } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { unitCost } from '../src/cost.js';
import { buildMatch, DEFAULT_MAP, defaultKing } from '../src/deploy.js';
import { mapToBoard, type MapDef } from '../src/map.js';
import { configFromSetup, createMatchFromPresets, DEFAULT_SETUP, resolveMap } from '../src/match.js';
import { DEFAULT_MAP_ID, getMap, listMaps } from '../src/mapRegistry.js';
import { supportedModes } from '../src/mapValidate.js';
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

describe('MatchSetup.mode', () => {
  const objectiveModes = ['king-of-the-hill', 'conquest', 'capture-the-flag'] as const;

  it('annihilation adds no keys: same config as no mode at all', () => {
    expect(configFromSetup({ ...DEFAULT_SETUP, mode: 'annihilation' })).toEqual(configFromSetup(DEFAULT_SETUP));
    const config = configFromSetup({ ...DEFAULT_SETUP, mapId: DEFAULT_MAP_ID, mode: 'annihilation' });
    expect('mode' in config || 'objectives' in config).toBe(false);
    expect(config.warbands.flat().some((s) => 'king' in s)).toBe(false);
  });

  it('kill-the-king: each side gets exactly one King, the default being its most expensive unit', () => {
    const config = configFromSetup({ ...DEFAULT_SETUP, mode: 'kill-the-king' });
    expect(config.mode).toBe('kill-the-king');
    expect('objectives' in config).toBe(false);
    for (const owner of [0, 1] as const) {
      const units = PRESETS[DEFAULT_SETUP.presets[owner]]!.units;
      const kings = config.warbands[owner].flatMap((s, i) => (s.king ? [i] : []));
      expect(kings).toEqual([defaultKing(units)]);
      for (const u of units) expect(unitCost(u)).toBeLessThanOrEqual(unitCost(units[kings[0]!]!));
    }
    const state = createGame(config);
    expect(state.mode?.kings).toEqual([`p0u${defaultKing(PRESETS[DEFAULT_SETUP.presets[0]]!.units)}`, `p1u${defaultKing(PRESETS[DEFAULT_SETUP.presets[1]]!.units)}`]);
  });

  it('kill-the-king: chosen King indices are honoured, and must be in range', () => {
    const state = createMatchFromPresets({ ...DEFAULT_SETUP, mode: 'kill-the-king', kings: [1, 0] });
    expect(state.mode?.kings).toEqual(['p0u1', 'p1u0']);
    expect(() => configFromSetup({ ...DEFAULT_SETUP, mode: 'kill-the-king', kings: [0, 99] })).toThrow(/King index 99/);
  });

  it('kill-the-king works on a map too', () => {
    const state = createMatchFromPresets({ ...DEFAULT_SETUP, mapId: listMaps()[1]!.id, mode: 'kill-the-king' });
    expect(state.mode?.mode).toBe('kill-the-king');
  });

  it('objective modes need a map', () => {
    for (const mode of objectiveModes) expect(() => configFromSetup({ ...DEFAULT_SETUP, mode })).toThrow(/needs a map/);
  });

  it.each(listMaps().flatMap((m) => supportedModes(m).filter((mode) => (objectiveModes as readonly string[]).includes(mode)).map((mode) => [m.id, mode] as const)))(
    'map %s in %s: the map objectives reach the engine',
    (id, mode) => {
      const map = getMap(id)!;
      const config = configFromSetup({ ...DEFAULT_SETUP, mapId: id, mode });
      expect(config.mode).toBe(mode);
      const key = mode === 'capture-the-flag' ? 'flags' : mode === 'king-of-the-hill' ? 'hill' : 'conquest';
      expect(config.objectives).toEqual({ [key]: map.objectives[key] });
      expect(config.warbands.flat().some((s) => 'king' in s)).toBe(false);
      const state = createGame(config);
      expect(state.mode?.mode).toBe(mode);
      expect(state.mode?.objectives).toEqual({ [key]: map.objectives[key] });
    },
  );

  it('a map lacking the mode objectives is rejected', () => {
    // The default map has no objectives at all.
    for (const mode of objectiveModes)
      expect(() => configFromSetup({ ...DEFAULT_SETUP, mapId: DEFAULT_MAP_ID, mode })).toThrow(/is invalid: .*needs/);
  });
});
