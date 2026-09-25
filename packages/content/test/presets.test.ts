import { describe, expect, it } from 'vitest';
import { PRESETS, PRESET_IDS, getPreset } from '../src/presets.js';
import { validateWarband } from '../src/warband.js';

describe('preset warbands', () => {
  it('exposes at least three presets', () => {
    expect(PRESET_IDS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(PRESET_IDS)('%s is legal under the default rules', (id) => {
    const result = validateWarband(PRESETS[id]!);
    expect(result.ok, result.errors.join('; ')).toBe(true);
  });

  it('gives every unit a distinct name within its warband', () => {
    for (const id of PRESET_IDS) {
      const names = PRESETS[id]!.units.map((u) => u.name);
      expect(new Set(names).size, `duplicate name in ${id}`).toBe(names.length);
    }
  });

  it('looks presets up by id and misses cleanly', () => {
    expect(getPreset('iron-wardens')).toBeDefined();
    expect(getPreset('no-such-band')).toBeUndefined();
  });
});
