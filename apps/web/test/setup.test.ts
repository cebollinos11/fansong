import { configFromSetup, DEFAULT_MAP_ID, getMap, getPreset, listMaps, supportedModes, type Warband } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import { effectiveMapId, launchFor, launchProblem, modeFor } from '../src/ui/SetupScreen.js';
import { armyChoice, type SavedArmy } from '../src/game/armies.js';

describe('launchFor', () => {
  const presets: [string, string] = ['iron-wardens', 'ashfang-raiders'];

  it('leaves the default map implicit so default setups are unchanged', () => {
    expect(launchFor('vsAI', presets, 7)).toEqual({
      kind: 'local',
      setup: { presets, seats: ['human', 'ai'], seed: 7 },
    });
    expect(launchFor('hotseat', presets, 7, DEFAULT_MAP_ID)).toEqual({
      kind: 'local',
      setup: { presets, seats: ['human', 'human'], seed: 7 },
    });
  });

  it('carries a chosen map into the local setup and its config', () => {
    const launch = launchFor('vsAI', presets, 7, 'old-forest');
    if (launch.kind !== 'local') throw new Error('expected local');
    expect(launch.setup.mapId).toBe('old-forest');
    expect(configFromSetup(launch.setup).board.terrain).toBeDefined();
  });

  it('online launches carry a built-in map, but not the default or a custom one', () => {
    expect(launchFor('online', presets, 7, 'old-forest')).toEqual({ kind: 'online', presets, seed: 7, mapId: 'old-forest' });
    expect(launchFor('online', presets, 7)).toEqual({ kind: 'online', presets, seed: 7 });
    expect(launchFor('online', presets, 7, 'custom-my-map')).toEqual({ kind: 'online', presets, seed: 7 });
  });
});

describe('launchFor game modes', () => {
  const presets: [string, string] = ['iron-wardens', 'ashfang-raiders'];

  it('leaves annihilation implicit and drops Kings outside kill-the-king', () => {
    expect(launchFor('vsAI', presets, 7, DEFAULT_MAP_ID, { mode: 'annihilation', kings: [1, 2] })).toEqual({
      kind: 'local',
      setup: { presets, seats: ['human', 'ai'], seed: 7 },
    });
    const koth = launchFor('hotseat', presets, 7, 'rolling-hills', { mode: 'king-of-the-hill', kings: [1, 2] });
    expect(koth).toEqual({
      kind: 'local',
      setup: { presets, seats: ['human', 'human'], seed: 7, mapId: 'rolling-hills', mode: 'king-of-the-hill' },
    });
  });

  it('carries mode and chosen Kings into the local setup and the engine config', () => {
    const launch = launchFor('vsAI', presets, 7, DEFAULT_MAP_ID, { mode: 'kill-the-king', kings: [2, 1] });
    if (launch.kind !== 'local') throw new Error('expected local');
    expect(launch.setup).toMatchObject({ mode: 'kill-the-king', kings: [2, 1] });
    const config = configFromSetup(launch.setup);
    expect(config.warbands[0]!.findIndex((u) => u.king)).toBe(2);
    expect(config.warbands[1]!.findIndex((u) => u.king)).toBe(1);
  });

  it('carries mode and Kings online as gameMode/kings', () => {
    expect(launchFor('online', presets, 7, 'old-forest', { mode: 'capture-the-flag' })).toEqual({
      kind: 'online',
      presets,
      seed: 7,
      mapId: 'old-forest',
      gameMode: 'capture-the-flag',
    });
    expect(launchFor('online', presets, 7, DEFAULT_MAP_ID, { mode: 'kill-the-king', kings: [0, 3] })).toEqual({
      kind: 'online',
      presets,
      seed: 7,
      gameMode: 'kill-the-king',
      kings: [0, 3],
    });
  });
});

describe('mode filtering', () => {
  it('online play falls back to the default map for custom maps', () => {
    expect(effectiveMapId('online', 'custom-my-map')).toBe(DEFAULT_MAP_ID);
    expect(effectiveMapId('online', 'old-forest')).toBe('old-forest');
    expect(effectiveMapId('vsAI', 'custom-my-map')).toBe('custom-my-map');
  });

  it('keeps a supported mode and falls back to annihilation otherwise', () => {
    const open = getMap(DEFAULT_MAP_ID)!;
    expect(modeFor(open, 'kill-the-king')).toBe('kill-the-king');
    expect(modeFor(open, 'capture-the-flag')).toBe('annihilation');
    for (const map of listMaps())
      for (const m of supportedModes(map)) expect(modeFor(map, m)).toBe(m);
  });
});

describe('launchFor with saved armies', () => {
  const horde: Warband = {
    name: 'Horde',
    units: Array.from({ length: 12 }, (_, i) => ({ name: `Grunt ${i}`, quality: 2, combat: 6, move: 5 })),
  };
  const armies: SavedArmy[] = [{ id: 'a1', warband: horde }];

  it('writes both rosters out when a side is a saved army, labelling it custom', () => {
    const launch = launchFor('vsAI', [armyChoice('a1'), 'iron-wardens'], 7, DEFAULT_MAP_ID, undefined, armies);
    expect(launch).toEqual({
      kind: 'local',
      setup: {
        presets: ['custom', 'iron-wardens'],
        warbands: [horde, getPreset('iron-wardens')],
        seats: ['human', 'ai'],
        seed: 7,
      },
    });
    if (launch.kind !== 'local') throw new Error('expected local');
    // Far over the preset budget, but armies have no point limit.
    expect(configFromSetup(launch.setup).warbands[0]).toHaveLength(12);
    expect(launchProblem(launch, getMap)).toBeNull();
  });

  it('online launches carry the rosters too', () => {
    const launch = launchFor('online', [armyChoice('a1'), armyChoice('a1')], 7, DEFAULT_MAP_ID, undefined, armies);
    expect(launch).toEqual({ kind: 'online', presets: ['custom', 'custom'], warbands: [horde, horde], seed: 7 });
    expect(launchProblem(launch, getMap)).toBeNull();
  });

  it('reports an army too big for the map deploy zone', () => {
    const huge: SavedArmy = { id: 'a2', warband: { name: 'Huge', units: Array.from({ length: 30 }, () => horde.units[0]!) } };
    const launch = launchFor('hotseat', [armyChoice('a2'), 'iron-wardens'], 7, 'twin-towers', undefined, [huge]);
    expect(launchProblem(launch, getMap)).toMatch(/deploy zone/);
  });
});
