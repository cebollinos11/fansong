import { configFromSetup, DEFAULT_MAP_ID } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import { launchFor } from '../src/ui/SetupScreen.js';

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

  it('online launches do not carry a map (yet)', () => {
    expect(launchFor('online', presets, 7, 'old-forest')).toEqual({ kind: 'online', presets, seed: 7 });
  });
});
