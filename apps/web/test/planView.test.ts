import { describe, expect, it } from 'vitest';
import {
  createGame,
  getActionPlans,
  vecKey,
  type GameConfig,
  type GameState,
  type UnitSpec,
} from '@fansong/engine';
import { buildPlanIndex, previewFor } from '../src/game/planView.js';

const config = (seed: number, p0: UnitSpec[], p1: UnitSpec[]): GameConfig => ({
  seed,
  board: { width: 11, height: 7 },
  warbands: [p0, p1],
});

function acting(c: GameConfig, actions: number): GameState {
  const s = createGame(c);
  s.active = 0;
  s.activeUnitId = 'p0u0';
  s.phase = 'acting';
  s.actionsRemaining = actions;
  s.units[0]!.activatedThisRound = true;
  return s;
}

const index = (s: GameState) => buildPlanIndex(getActionPlans(s), s);

const mover: UnitSpec = { name: 'Mover', quality: 3, combat: 3, move: 3, pos: { x: 2, y: 3 } };
const far: UnitSpec = { name: 'Far', quality: 3, combat: 3, pos: { x: 10, y: 0 } };

describe('buildPlanIndex', () => {
  it('tiers the reachable hexes and reports the deepest tier', () => {
    const one = index(acting(config(1, [mover], [far]), 1));
    expect(one.maxCost).toBe(1);
    expect(one.reach.every((t) => t.cost === 1)).toBe(true);

    const two = index(acting(config(1, [mover], [far]), 2));
    expect(two.maxCost).toBe(2);
    expect(two.reach.some((t) => t.cost === 2)).toBe(true);
    // The first tier is unchanged by having a second action in hand.
    expect(two.reach.filter((t) => t.cost === 1).map((t) => vecKey(t.cell)))
      .toEqual(one.reach.map((t) => vecKey(t.cell)));
  });

  it('commits the cheapest way to a hex reachable by more than one route', () => {
    const s = acting(config(2, [mover], [far]), 3);
    const idx = index(s);
    for (const tile of idx.reach) {
      expect(idx.byCell.get(vecKey(tile.cell))!.cost).toBeLessThanOrEqual(tile.cost);
    }
    // One entry per hex, however many plans reach it.
    const cells = new Set(idx.reach.map((t) => vecKey(t.cell)));
    expect(cells.size).toBe(idx.reach.length);
  });

  it('separates enemies it can hit now from those it must walk to', () => {
    const contact: UnitSpec = { name: 'Contact', quality: 3, combat: 3, pos: { x: 3, y: 3 } };
    const away: UnitSpec = { name: 'Away', quality: 3, combat: 3, pos: { x: 6, y: 1 } };
    // Three actions: the far one needs two of them just to get into contact,
    // because breaking away from the first foe halts the walk on the way past.
    const idx = index(acting(config(3, [mover], [contact, away]), 3));

    expect(idx.strikeNowIds).toEqual(['p1u0']);
    expect(idx.approachIds).toEqual(['p1u1']);
    expect(idx.byTarget.get('p1u0')!.cost).toBe(1);
    expect(idx.byTarget.get('p1u1')!.cost).toBe(3);
    expect(idx.byTarget.get('p1u1')!.provokes).toBe(1);
  });

  it('offers the pressed twin only alongside a plain plan of the same kind', () => {
    const foe: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 5, y: 3 } };

    // Two actions: enough to walk in and swing, not to press.
    const two = index(acting(config(4, [mover], [foe]), 2));
    expect(two.byTarget.get('p1u0')!.cost).toBe(2);
    expect(two.pressedByTarget.has('p1u0')).toBe(false);

    // Three: both offers stand, and they agree on the kind of blow.
    const three = index(acting(config(4, [mover], [foe]), 3));
    expect(three.byTarget.get('p1u0')!.cost).toBe(2);
    expect(three.pressedByTarget.get('p1u0')!.cost).toBe(3);
    expect(three.pressedByTarget.get('p1u0')!.kind).toBe(three.byTarget.get('p1u0')!.kind);
  });

  it('prefers shooting now over walking into melee at the same price', () => {
    // An archer can shoot this target where it stands, or spend the same action
    // walking adjacent; standing still is the offer that keeps its distance.
    const archer: UnitSpec = { name: 'Archer', quality: 3, combat: 3, move: 3, ranged: 6, pos: { x: 2, y: 3 } };
    const foe: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 4, y: 3 } };
    const idx = index(acting(config(5, [archer], [foe]), 2));

    const offer = idx.byTarget.get('p1u0')!;
    expect(offer.kind).toBe('shoot');
    expect(offer.waypoints).toEqual([]);
    expect(idx.strikeNowIds).toEqual(['p1u0']);
  });

  it('puts the enemy hex in reach of a click, so aiming at it works', () => {
    const foe: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 5, y: 3 } };
    const idx = index(acting(config(6, [mover], [foe]), 2));
    expect(idx.byCell.get('5,3')).toBe(idx.byTarget.get('p1u0'));
  });

  it('is empty when there is nothing to plan', () => {
    const idle = createGame(config(7, [mover], [far]));
    const idx = index(idle);
    expect(idx.reach).toEqual([]);
    expect(idx.maxCost).toBe(0);
    expect(idx.byCell.size).toBe(0);
  });
});

describe('previewFor', () => {
  it('traces the walk to a hex two actions out', () => {
    const s = acting(config(10, [mover], [far]), 2);
    const idx = index(s);
    const tile = idx.reach.find((t) => t.cost === 2)!;

    const preview = previewFor(idx, tile.cell)!;
    expect(preview.kind).toBe('move');
    expect(preview.cost).toBe(2);
    expect(preview.waypoints).toHaveLength(2);
    expect(preview.path[0]).toEqual({ x: 2, y: 3 });
    expect(preview.path[preview.path.length - 1]).toEqual(tile.cell);
  });

  it('traces the approach when the hex holds an enemy', () => {
    const foe: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 5, y: 3 } };
    const s = acting(config(11, [mover], [foe]), 2);

    const preview = previewFor(index(s), { x: 5, y: 3 })!;
    expect(preview.kind).toBe('attack');
    expect(preview.targetId).toBe('p1u0');
    expect(preview.cost).toBe(2);
    // It ends on the approach hex, not on the target.
    expect(preview.path[preview.path.length - 1]).not.toEqual({ x: 5, y: 3 });
  });

  it('has nothing to say about a hex out of reach', () => {
    const s = acting(config(12, [mover], [far]), 1);
    expect(previewFor(index(s), { x: 10, y: 6 })).toBeNull();
  });
});
