import { describe, expect, it } from 'vitest';
import { PRESET_UNITS, SEA_CREATURES, WILD_UNITS } from '@fansong/content';
import { UNIT_SPRITES } from '../src/three/unitSprites.js';

describe('wild units and sprites', () => {
  it('draws every wild unit with a sprite of its own name', () => {
    for (const u of WILD_UNITS) expect(u.name in UNIT_SPRITES, u.name).toBe(true);
  });

  it('leaves no sprite out of the run but the creatures of the sea: each is a preset unit, a preset look or a wild unit', () => {
    const drawn = new Set<string>();
    for (const [name, unit] of Object.entries(PRESET_UNITS)) drawn.add(UNIT_SPRITES[unit.look ?? name]!);
    for (const u of WILD_UNITS) drawn.add(UNIT_SPRITES[u.name]!);
    const unused = Object.entries(UNIT_SPRITES).filter(([name, path]) => !(name in PRESET_UNITS) && !SEA_CREATURES.includes(name) && !drawn.has(path));
    expect(unused.map(([name]) => name)).toEqual([]);
  });
});
