import { describe, expect, it } from 'vitest';
import { createGame } from '@fansong/engine';
import { configFromSetup } from '@fansong/content';
import { limitsForMode, parseLimitsByMode } from '../src/game/limits.js';
import { loadSetupPrefs, SETUP_PREFS_KEY } from '../src/game/setupPrefs.js';
import { launchFor } from '../src/ui/SetupScreen.js';
import { modeHud } from '../src/ui/modeView.js';

describe('custom game limits', () => {
  it('keeps only values a mode can use', () => {
    expect(limitsForMode('conquest', { roundLimit: 7, targetScore: 5 })).toEqual({ roundLimit: 7, targetScore: 5 });
    expect(limitsForMode('annihilation', { roundLimit: null, targetScore: 5 })).toEqual({ roundLimit: null });
    expect(limitsForMode('capture-the-flag', { targetScore: 5 })).toBeUndefined();
    expect(limitsForMode('conquest', { roundLimit: 0, targetScore: 99 })).toBeUndefined();
    expect(limitsForMode('conquest', 'junk')).toBeUndefined();
  });

  it('parses stored per-mode limits, dropping junk', () => {
    expect(parseLimitsByMode({ conquest: { targetScore: 4 }, bogus: { roundLimit: 3 }, annihilation: { roundLimit: -1 } })).toEqual({
      conquest: { targetScore: 4 },
    });
    const storage = { getItem: () => JSON.stringify({ limits: { 'capture-the-flag': { roundLimit: 9 } } }), setItem: () => {}, removeItem: () => {} };
    expect(loadSetupPrefs(storage as never).limits).toEqual({ 'capture-the-flag': { roundLimit: 9 } });
    expect(SETUP_PREFS_KEY).toBeTruthy();
  });

  it('puts the limits in the local setup, and they reach the game and its HUD', () => {
    const { setup } = launchFor('hotseat', ['iron-wardens', 'ashfang-raiders'], 1, 'open-field', {
      mode: 'conquest',
      limits: { roundLimit: 6, targetScore: 3 },
    });
    expect(setup.limits).toEqual({ roundLimit: 6, targetScore: 3 });
    const state = createGame(configFromSetup(setup));
    expect(state.limits).toEqual({ roundLimit: 6, targetScore: 3 });
    expect(modeHud(state)?.goal).toBe('First to 3 points · ends after round 6');
  });

  it('leaves default setups without limits, and annihilation shows a HUD only with a round limit', () => {
    const plain = launchFor('hotseat', ['iron-wardens', 'ashfang-raiders'], 1).setup;
    expect(plain.limits).toBeUndefined();
    expect(modeHud(createGame(configFromSetup(plain)))).toBeNull();
    const capped = launchFor('hotseat', ['iron-wardens', 'ashfang-raiders'], 1, undefined, {
      mode: 'annihilation',
      limits: { roundLimit: 8 },
    }).setup;
    expect(modeHud(createGame(configFromSetup(capped)))?.goal).toContain('ends after round 8');
  });
});
