import { describe, expect, it } from 'vitest';
import { PRESET_UNITS } from '@fansong/content';
import { UNIT_SPRITES } from '../src/three/unitSprites.js';

describe('preset units and sprites', () => {
  it('draws every preset unit with a sprite, its own or its look', () => {
    for (const [name, unit] of Object.entries(PRESET_UNITS)) expect((unit.look ?? name) in UNIT_SPRITES, name).toBe(true);
  });

  it('leaves no sprite without a preset unit drawn as it', () => {
    const drawn = new Set<string>();
    for (const [name, unit] of Object.entries(PRESET_UNITS)) drawn.add(UNIT_SPRITES[unit.look ?? name]!);
    const unused = Object.entries(UNIT_SPRITES).filter(([, path]) => !drawn.has(path));
    expect(unused.map(([name]) => name)).toEqual([]);
  });
});
