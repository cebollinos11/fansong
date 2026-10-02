import { describe, expect, it } from 'vitest';
import { loadSetupPrefs, saveSetupPrefs, SETUP_PREFS_KEY, type SetupPrefs } from '../src/game/setupPrefs.js';
import type { MapStorage } from '../src/game/customMaps.js';

function memoryStorage(initial: Record<string, string> = {}): MapStorage {
  const data = { ...initial };
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('setup prefs', () => {
  it('round-trips the choices', () => {
    const storage = memoryStorage();
    const prefs: SetupPrefs = {
      mode: 'hotseat',
      sides: ['army:a1', 'ashfang-raiders-medium'],
      mapId: 'old-forest',
      gameMode: 'kill-the-king',
      kings: [2, 0],
    };
    saveSetupPrefs(storage, prefs);
    expect(loadSetupPrefs(storage)).toEqual(prefs);
  });

  it('is empty without storage or with corrupt storage', () => {
    expect(loadSetupPrefs(null)).toEqual({});
    expect(loadSetupPrefs(memoryStorage({ [SETUP_PREFS_KEY]: '{oops' }))).toEqual({});
    expect(loadSetupPrefs(memoryStorage({ [SETUP_PREFS_KEY]: '7' }))).toEqual({});
  });

  it('drops fields that do not parse and keeps the rest', () => {
    const stored = { mode: 'solo', sides: ['iron-wardens-medium'], mapId: 3, gameMode: 'tag', kings: [1, -1], extra: 1 };
    expect(loadSetupPrefs(memoryStorage({ [SETUP_PREFS_KEY]: JSON.stringify(stored) }))).toEqual({});
    const partly = { mode: 'vsAI', sides: ['a', 2], mapId: 'rolling-hills' };
    expect(loadSetupPrefs(memoryStorage({ [SETUP_PREFS_KEY]: JSON.stringify(partly) }))).toEqual({
      mode: 'vsAI',
      mapId: 'rolling-hills',
    });
  });

  it('ignores a storage that throws on write', () => {
    const storage: MapStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(() => saveSetupPrefs(storage, { mode: 'vsAI' })).not.toThrow();
  });
});
