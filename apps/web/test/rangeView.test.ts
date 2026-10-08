import { describe, expect, it } from 'vitest';
import { createGame, vecKey } from '@fansong/engine';
import { rangeShooter, shotRangeView } from '../src/game/rangeView.js';

const state = () =>
  createGame({
    seed: 1,
    board: { width: 9, height: 9 },
    warbands: [
      [
        { name: 'Archer', quality: 3, combat: 3, ranged: 4, pos: { x: 0, y: 4 } },
        { name: 'Sword', quality: 3, combat: 3, pos: { x: 0, y: 6 } },
      ],
      [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 6, y: 4 } }],
    ],
  });

describe('the shot range shown under the pointer', () => {
  it('asks about the unit on the hex, else the one being moved', () => {
    const s = state();
    expect(rangeShooter(s, { x: 3, y: 4 }, 'p0u0')).toEqual({ owner: 0, range: 4, unitId: 'p0u0' });
    expect(rangeShooter(s, { x: 0, y: 4 }, null)).toEqual({ owner: 0, range: 4, unitId: 'p0u0' });
    expect(rangeShooter(s, { x: 6, y: 4 }, 'p0u0')).toEqual({ owner: 1, range: 5, unitId: 'p1u0' });
  });

  it('falls back to range 5 for a unit with no ranged attack, or no unit at all', () => {
    const s = state();
    expect(rangeShooter(s, { x: 3, y: 4 }, 'p0u1')).toEqual({ owner: 0, range: 5, unitId: 'p0u1' });
    expect(rangeShooter(s, { x: 3, y: 4 }, null)).toEqual({ owner: s.active, range: 5 });
    // Nobody active: from (1,4) the foe at (6,4) is exactly 5 off.
    expect(shotRangeView(s, { x: 1, y: 4 }, null).targetIds).toEqual(['p1u0']);
    expect(shotRangeView(s, { x: 0, y: 5 }, null).targetIds).toEqual([]);
  });

  it('marks an enemy the move would bring into range apart from the empty reach', () => {
    const s = state();
    // From where it stands the foe is 6 off: out of range.
    const here = shotRangeView(s, { x: 0, y: 4 }, 'p0u0');
    expect(here.targetIds).toEqual([]);
    expect(here.overlays[1]!.cells).toEqual([]);
    const there = shotRangeView(s, { x: 3, y: 4 }, 'p0u0');
    expect(there.targetIds).toEqual(['p1u0']);
    expect(there.overlays[1]!.cells.map(vecKey)).toEqual(['6,4']);
    expect(there.overlays[0]!.cells.length).toBeGreaterThan(0);
    expect(there.overlays[0]!.cells.map(vecKey)).not.toContain('6,4');
  });

  it('shows nothing where the shooter would be locked in melee', () => {
    expect(shotRangeView(state(), { x: 5, y: 4 }, 'p0u0')).toEqual({ overlays: [], targetIds: [] });
  });

  it('shows a spell in hand at its own reach, the hex next door included', () => {
    const s = state();
    s.phase = 'acting';
    s.activeUnitId = 'p0u1';
    s.spell = { power: 1 } as NonNullable<typeof s.spell>;
    expect(rangeShooter(s, { x: 0, y: 6 }, 'p0u1')).toEqual({ owner: 0, range: 3, unitId: 'p0u1', spell: true });
    expect(shotRangeView(s, { x: 0, y: 6 }, 'p0u1').overlays[0]!.cells.map(vecKey)).toContain('0,7');
    // Out of a power-1 spell's 3 hexes from (2,4); inside them from (3,4).
    expect(shotRangeView(s, { x: 2, y: 4 }, 'p0u1').targetIds).toEqual([]);
    expect(shotRangeView(s, { x: 3, y: 4 }, 'p0u1').targetIds).toEqual(['p1u0']);
  });
});
