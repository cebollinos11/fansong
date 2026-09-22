import { chooseCommand } from '@fansong/ai';
import { getMap, listMaps, mapToBoard, mapToJson, newEditorMap, validateMap, type MapDef, type MatchSetup } from '@fansong/content';
import { hashGameState, runReplay } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { LocalMatchClient } from '../src/game/client.js';
import {
  allPlayableMaps,
  CUSTOM_MAPS_KEY,
  customMapId,
  customMapLookup,
  deleteCustomMap,
  loadCustomMaps,
  parseMapText,
  playableCustomMaps,
  saveCustomMap,
  type MapStorage,
} from '../src/game/customMaps.js';

function memoryStorage(initial: Record<string, string> = {}): MapStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

/** A playable custom map: Rocky Pass's terrain under a new id/name. */
const CUSTOM: MapDef = { ...getMap('rocky-pass')!, id: 'my-pass', name: 'My Pass' };
/** Structurally fine but unplayable: no deploy zones. */
const BROKEN: MapDef = { ...newEditorMap(12, 10, 'Broken'), deployZones: [[], []] };

describe('custom map storage', () => {
  it('saves, lists, updates in place and deletes', () => {
    const s = memoryStorage();
    expect(loadCustomMaps(s)).toEqual([]);

    expect(saveCustomMap(s, CUSTOM)).toEqual({ map: CUSTOM, replaced: false });
    expect(saveCustomMap(s, BROKEN).replaced).toBe(false);
    expect(loadCustomMaps(s).map((m) => m.id)).toEqual(['my-pass', 'broken']);

    const edited = { ...CUSTOM, hexes: CUSTOM.hexes.map(() => ({ elevation: 1 })) };
    expect(saveCustomMap(s, edited).replaced).toBe(true);
    expect(loadCustomMaps(s)).toEqual([edited, BROKEN]);

    deleteCustomMap(s, 'my-pass');
    expect(loadCustomMaps(s)).toEqual([BROKEN]);
    deleteCustomMap(s, 'nope'); // no-op
    expect(loadCustomMaps(s)).toEqual([BROKEN]);
  });

  it('never shadows a built-in map id', () => {
    const s = memoryStorage();
    const named = { ...CUSTOM, id: 'old-forest', name: 'Old Forest' };
    expect(customMapId('old-forest')).toBe('old-forest-custom');
    expect(customMapId('my-pass')).toBe('my-pass');
    expect(saveCustomMap(s, named).map.id).toBe('old-forest-custom');
    expect(customMapLookup(s)('old-forest')).toBe(getMap('old-forest'));
    expect(customMapLookup(s)('old-forest-custom')?.name).toBe('Old Forest');
  });

  it('tolerates missing, corrupt or foreign storage', () => {
    expect(loadCustomMaps(null)).toEqual([]);
    expect(loadCustomMaps(memoryStorage({ [CUSTOM_MAPS_KEY]: '{not json' }))).toEqual([]);
    expect(loadCustomMaps(memoryStorage({ [CUSTOM_MAPS_KEY]: '{"a":1}' }))).toEqual([]);
    const mixed = JSON.stringify([{ junk: true }, CUSTOM, getMap('old-forest'), CUSTOM]);
    // Junk, built-in ids and duplicates are dropped.
    expect(loadCustomMaps(memoryStorage({ [CUSTOM_MAPS_KEY]: mixed }))).toEqual([CUSTOM]);
    expect(() => saveCustomMap(null, CUSTOM)).toThrow(/unavailable/);
    const full: MapStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => saveCustomMap(full, CUSTOM)).toThrow(/full/);
  });

  it('only offers maps that pass validateMap for play', () => {
    const s = memoryStorage();
    saveCustomMap(s, BROKEN);
    saveCustomMap(s, CUSTOM);
    expect(validateMap(BROKEN).ok).toBe(false);
    expect(playableCustomMaps(s)).toEqual([CUSTOM]);
    expect(allPlayableMaps(s)).toEqual([...listMaps(), CUSTOM]);
    const lookup = customMapLookup(s);
    expect(lookup('my-pass')).toEqual(CUSTOM);
    expect(lookup('broken')).toBeUndefined();
    expect(lookup('rocky-pass')).toBe(getMap('rocky-pass'));
  });
});

describe('parseMapText', () => {
  it('reads exported map JSON back to an equal map', () => {
    expect(parseMapText(mapToJson(CUSTOM))).toEqual(CUSTOM);
    expect(parseMapText(mapToJson(BROKEN))).toEqual(BROKEN);
  });

  it('rejects files it could not safely edit', () => {
    expect(() => parseMapText('nope')).toThrow(/Not valid JSON/);
    expect(() => parseMapText('{"id":"x"}')).toThrow(/invalid map/);
    const short = { ...CUSTOM, hexes: CUSTOM.hexes.slice(1) };
    expect(() => parseMapText(JSON.stringify(short))).toThrow(/hexes/);
    const huge = newEditorMap(12, 10);
    expect(() => parseMapText(JSON.stringify({ ...huge, width: 500, hexes: [] }))).toThrow(/size/);
  });
});

// Hotseat: no AI timers, so the game can be driven synchronously.
const SETUP: MatchSetup = { presets: ['hollow-watch', 'free-company'], seats: ['human', 'human'], seed: 5 };

describe('LocalMatchClient on a custom map', () => {
  it('plays a saved custom map and records it in the replay', () => {
    const s = memoryStorage();
    saveCustomMap(s, CUSTOM);
    const client = new LocalMatchClient({ ...SETUP, mapId: 'my-pass' }, customMapLookup(s));
    // Deleting the map mid-game must not break the replay.
    deleteCustomMap(s, 'my-pass');
    let steps = 0;
    while (client.getState().phase !== 'gameOver' && steps++ < 5000) client.send(chooseCommand(client.getState()));
    const replay = client.getReplay();
    const live = client.getState();
    client.dispose();

    expect(live.phase).toBe('gameOver');
    expect(replay.config.board).toEqual(mapToBoard(CUSTOM));
    expect(hashGameState(runReplay(replay).final)).toBe(hashGameState(live));
  });

  it('refuses an unknown custom map id', () => {
    expect(
      () => new LocalMatchClient({ ...SETUP, mapId: 'my-pass' }),
    ).toThrow(/unknown map/);
  });
});
