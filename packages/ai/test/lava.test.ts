import { describe, expect, it } from 'vitest';
import { createGame, makeHexGrid, vecKey, type GameState, type HexTerrain, type UnitSpec, type Vec } from '@fansong/engine';
import { chooseCommand } from '../src/index.js';

const U = (name: string, v: Vec, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name,
  quality: 3,
  combat: 3,
  pos: v,
  ...extra,
});

const W = 12;
const H = 9;
const grid = makeHexGrid({ width: W, height: H, blocked: [] });

function game(w0: UnitSpec[], w1: UnitSpec[], lava: Vec[]): GameState {
  const terrain: Record<string, HexTerrain> = {};
  for (const v of lava) terrain[vecKey(v)] = { feature: 'lava' };
  return createGame({ seed: 3, board: { width: W, height: H, terrain }, warbands: [w0, w1] });
}

/** Put `unitId` mid-activation with `actions` actions (no dice, so no luck involved). */
function activate(s: GameState, unitId: string, actions = 2): GameState {
  const next = structuredClone(s);
  next.units.find((u) => u.id === unitId)!.activatedThisRound = true;
  return { ...next, phase: 'acting', activeUnitId: unitId, actionsRemaining: actions, activationCount: 1 };
}

describe('AI and lava', () => {
  it('attacks the foe with lava at its back', () => {
    const me = { x: 5, y: 4 };
    const [a, b] = grid.neighbors(me);
    // Identical foes; only the second (the later command) has lava behind it.
    const s = activate(game([U('me', me)], [U('a', a!), U('b', b!)], [grid.stepAway(me, b!)]), 'p0u0');
    expect(chooseCommand(s)).toMatchObject({ type: 'Attack', targetId: 'p1u1' });
  });

  it('does not attack from a spot where losing drops it into the lava, given a choice', () => {
    const me = { x: 5, y: 4 };
    const [a, b] = grid.neighbors(me);
    // Lava behind *us* as seen from the first foe: a loss to it would push us in.
    const s = activate(game([U('me', me)], [U('a', a!), U('b', b!)], [grid.stepAway(a!, me)]), 'p0u0');
    expect(chooseCommand(s)).toMatchObject({ type: 'Attack', targetId: 'p1u1' });
  });

  it('a flyer lands beside a foe on solid ground rather than hovering over lava', () => {
    const foe = { x: 6, y: 4 };
    const around = grid.neighbors(foe);
    // Whichever side the one solid hex is on, that is where it lands.
    for (const solid of around) {
      const lava = around.filter((v) => vecKey(v) !== vecKey(solid));
      const s = activate(game([U('bird', { x: 3, y: 4 }, { flying: true })], [U('foe', foe)], lava), 'p0u0');
      expect(chooseCommand(s)).toEqual({ type: 'Move', unitId: 'p0u0', to: solid });
    }
  });
});
