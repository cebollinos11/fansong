import { presetUnit, type WarbandUnit } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import { unitKinds } from '../src/ui/unitKinds.js';

const ironguard = presetUnit('Ironguard')!;
const renamed: WarbandUnit = { ...ironguard, name: 'Gate Warden', look: 'Ironguard' };

describe('unitKinds', () => {
  it('folds units that differ only by name, in order of first appearance', () => {
    const bulwark = presetUnit('Bulwark')!;
    const kinds = unitKinds([ironguard, bulwark, renamed, ironguard]);
    expect(kinds.map((k) => [k.unit.name, k.count])).toEqual([
      ['Ironguard', 3],
      ['Bulwark', 1],
    ]);
  });

  it('keeps units apart when their stats, look or tint differ', () => {
    const tinted = { ...ironguard, tint: '#ff0000' };
    const tougher = { ...ironguard, tough: true };
    const otherLook = { ...ironguard, look: 'Bulwark' };
    expect(unitKinds([ironguard, tinted, tougher, otherLook])).toHaveLength(4);
  });

  it('ignores the order of a unit’s fields', () => {
    const shuffled = Object.fromEntries(Object.entries(ironguard).reverse()) as WarbandUnit;
    expect(unitKinds([ironguard, shuffled])).toEqual([{ unit: ironguard, count: 2 }]);
  });
});
