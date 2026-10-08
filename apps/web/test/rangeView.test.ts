import { describe, expect, it } from 'vitest';
import { createGame, vecKey } from '@fansong/engine';
import { rangeShooter, shotRangeOverlays } from '../src/game/rangeView.js';

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
    expect(rangeShooter(s, { x: 3, y: 4 }, 'p0u0')?.id).toBe('p0u0');
    expect(rangeShooter(s, { x: 0, y: 4 }, null)?.id).toBe('p0u0');
    // A unit with no ranged attack has no range to show, wherever it stands.
    expect(rangeShooter(s, { x: 3, y: 4 }, 'p0u1')).toBeNull();
    expect(rangeShooter(s, { x: 0, y: 6 }, 'p0u0')).toBeNull();
    expect(rangeShooter(s, { x: 3, y: 4 }, null)).toBeNull();
  });

  it('marks an enemy the move would bring into range apart from the empty reach', () => {
    const s = state();
    // From where it stands the foe is 6 off: out of range.
    const here = shotRangeOverlays(s, { x: 0, y: 4 }, 'p0u0');
    expect(here[1]!.cells).toEqual([]);
    const there = shotRangeOverlays(s, { x: 3, y: 4 }, 'p0u0');
    expect(there[1]!.cells.map(vecKey)).toEqual(['6,4']);
    expect(there[0]!.cells.length).toBeGreaterThan(0);
    expect(there[0]!.cells.map(vecKey)).not.toContain('6,4');
  });

  it('shows nothing where the shooter would be locked in melee', () => {
    expect(shotRangeOverlays(state(), { x: 5, y: 4 }, 'p0u0')).toEqual([]);
  });
});
