import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createGame,
  getActionPlans,
  getLegalCommands,
  makeHexGrid,
  MAX_PLANNED_ACTIONS,
  multiMoveReach,
  vecKey,
  type ActionPlan,
  type Command,
  type GameConfig,
  type GameState,
  type UnitSpec,
} from '../src/index.js';

const config = (seed: number, p0: UnitSpec[], p1: UnitSpec[], width = 11, height = 7): GameConfig => ({
  seed,
  board: { width, height },
  warbands: [p0, p1],
});

/** Mid-activation for `p0u0` with `actions` in hand, RNG untouched. */
function acting(c: GameConfig, actions = 1): GameState {
  const s = createGame(c);
  s.active = 0;
  s.activeUnitId = 'p0u0';
  s.phase = 'acting';
  s.actionsRemaining = actions;
  s.units[0]!.activatedThisRound = true;
  return s;
}

const moves = (plans: ActionPlan[]): ActionPlan[] => plans.filter((p) => p.kind === 'move');
const at = (plans: ActionPlan[], cost: number): Set<string> =>
  new Set(moves(plans).filter((p) => p.cost === cost).map((p) => vecKey(p.to)));
const strikes = (plans: ActionPlan[], targetId: string, kind: 'attack' | 'shoot'): ActionPlan[] =>
  plans.filter((p) => p.kind === kind && p.targetId === targetId);
const plain = (plans: ActionPlan[], targetId: string, kind: 'attack' | 'shoot'): ActionPlan | undefined =>
  strikes(plans, targetId, kind).find((p) => !p.pressed);
const pressed = (plans: ActionPlan[], targetId: string, kind: 'attack' | 'shoot'): ActionPlan | undefined =>
  strikes(plans, targetId, kind).find((p) => p.pressed);

const mover: UnitSpec = { name: 'Mover', quality: 3, combat: 3, move: 3, pos: { x: 2, y: 3 } };

describe('getActionPlans parity with getLegalCommands', () => {
  const cases: Array<[string, GameConfig]> = [
    ['open field', config(1, [mover], [{ name: 'Far', quality: 3, combat: 3, pos: { x: 10, y: 0 } }])],
    ['enemy in contact', config(2, [mover], [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 3, y: 3 } }])],
    ['enemy nearby', config(3, [mover], [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 5, y: 3 } }])],
    [
      'archer with a target in range',
      config(
        4,
        [{ ...mover, ranged: 6 }],
        [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 6, y: 3 } }],
      ),
    ],
  ];

  // The load-bearing guarantee: with one action in hand the planner is exactly
  // the legal-command list, so nothing about today's play changes.
  it.each(cases)('at one action, %s, first steps equal the legal list', (_name, c) => {
    const s = acting(c, 1);
    const legal = getLegalCommands(s).filter((l) => l.type === 'Move' || l.type === 'Attack' || l.type === 'Shoot');
    const firsts = getActionPlans(s).map((p) => p.steps[0]!);
    expect(firsts).toEqual(legal);
  });

  it('every plan is a chain of commands the reducer accepts, ending where it says', () => {
    const s = acting(config(5, [mover], [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 6, y: 1 } }]), 3);
    const plans = getActionPlans(s);
    expect(plans.length).toBeGreaterThan(20);
    for (const p of plans) {
      let cur = s;
      for (const step of p.steps) {
        // Throws if the step is illegal in the state the previous step produced.
        cur = applyCommand(cur, step).state;
      }
      if (p.kind === 'move') {
        expect(cur.units.find((u) => u.id === 'p0u0')!.pos).toEqual(p.to);
      }
    }
  });

  it('is deterministic across calls and across a clone', () => {
    const s = acting(config(6, [mover], [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 5, y: 2 } }]), 3);
    expect(getActionPlans(s)).toEqual(getActionPlans(s));
    expect(getActionPlans(structuredClone(s))).toEqual(getActionPlans(s));
  });

  it('plans nothing outside an activation with actions left', () => {
    expect(getActionPlans(acting(config(7, [mover], [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 9, y: 0 } }]), 0)))
      .toEqual([]);
    const idle = createGame(config(8, [mover], [{ name: 'Foe', quality: 3, combat: 3, pos: { x: 9, y: 0 } }]));
    expect(getActionPlans(idle)).toEqual([]);
  });
});

describe('multi-action reach', () => {
  const far: UnitSpec = { name: 'Far', quality: 3, combat: 3, pos: { x: 10, y: 0 } };

  it('adds a second, disjoint layer beyond one move', () => {
    const s = acting(config(10, [mover], [far]), 2);
    const plans = getActionPlans(s);
    const one = at(plans, 1);
    const two = at(plans, 2);
    // The one-action layer is unchanged...
    const legalMoves = new Set(
      getLegalCommands(acting(config(10, [mover], [far]), 1))
        .filter((c): c is Extract<Command, { type: 'Move' }> => c.type === 'Move')
        .map((c) => vecKey(c.to)),
    );
    expect(one).toEqual(legalMoves);
    // ...and the second layer is strictly new ground, out to six hexes.
    expect(two.size).toBeGreaterThan(0);
    for (const k of two) expect(one.has(k)).toBe(false);
    expect(two.has('8,3')).toBe(true);
  });

  it('spends a second action to get past a zone-of-control stop hex', () => {
    // From (2,3), every walk to (5,3) crosses contact with the enemy at (4,3).
    const enemy: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 4, y: 3 } };
    const one = getActionPlans(acting(config(11, [mover], [enemy]), 1));
    expect(at(one, 1).has('5,3')).toBe(false);

    const two = getActionPlans(acting(config(11, [mover], [enemy]), 2));
    const plan = moves(two).find((p) => vecKey(p.to) === '5,3');
    expect(plan).toBeDefined();
    expect(plan!.cost).toBe(2);
    expect(plan!.waypoints).toHaveLength(2);
    expect(plan!.steps.every((c) => c.type === 'Move')).toBe(true);
    // Open ground lets the second leg swing wide of the enemy, so this costs an
    // action but risks nothing.
    expect(plan!.provokes).toBe(0);
  });

  it('leaves a hex nobody provokes from unmarked', () => {
    const s = acting(config(12, [mover], [far]), 2);
    expect(moves(getActionPlans(s)).every((p) => p.provokes === 0)).toBe(true);
  });

  it('marks every chain that walks out of contact', () => {
    // Already toe to toe: the first leg leaves contact whatever it does.
    const enemy: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 3, y: 3 } };
    const s = acting(config(16, [mover], [enemy]), 2);
    expect(moves(getActionPlans(s)).every((p) => p.provokes === 1)).toBe(true);
  });

  it('does not count a knocked-down enemy as holding the unit in place', () => {
    const enemy: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 3, y: 3 } };
    const s = acting(config(17, [mover], [enemy]), 2);
    s.units.find((u) => u.id === 'p1u0')!.knockedDown = true;
    expect(moves(getActionPlans(s)).every((p) => p.provokes === 0)).toBe(true);
  });

  it('walks through a friend but never stands on one, at any cost', () => {
    const friend: UnitSpec = { name: 'Friend', quality: 3, combat: 3, pos: { x: 3, y: 3 } };
    const s = acting(config(13, [mover, friend], [far]), 2);
    const plans = getActionPlans(s);
    // Reachable *through* the friend in a single move.
    expect(at(plans, 1).has('4,3')).toBe(true);
    // But its hex is never a destination, however many actions are spent.
    expect(moves(plans).some((p) => vecKey(p.to) === '3,3')).toBe(false);
    // Nor a waypoint of any chain.
    expect(moves(plans).some((p) => p.waypoints.some((w) => vecKey(w) === '3,3'))).toBe(false);
  });

  it('records a path that is contiguous and as long as the walk', () => {
    const s = acting(config(14, [mover], [far]), 3);
    const board = makeHexGrid(s.board);
    for (const p of moves(getActionPlans(s))) {
      expect(p.waypoints).toHaveLength(p.cost);
      expect(p.path[0]).toEqual({ x: 2, y: 3 });
      expect(p.path[p.path.length - 1]).toEqual(p.to);
      for (let i = 1; i < p.path.length; i++) {
        expect(board.distance(p.path[i - 1]!, p.path[i]!)).toBe(1);
      }
    }
  });

  it('caps the chain at three actions however many are held', () => {
    // A plodder on a long board, so cost keeps climbing if nothing stops it.
    const plodder: UnitSpec = { ...mover, move: 1 };
    const c = config(15, [plodder], [{ name: 'Far', quality: 3, combat: 3, pos: { x: 29, y: 0 } }], 31, 7);
    const board = makeHexGrid(createGame(c).board);
    const unit = createGame(c).units[0]!;
    // The helper honours whatever cap it is handed...
    expect(Math.max(...[...multiMoveReach(acting(c, 1), unit, board, 6).values()].map((n) => n.cost))).toBe(6);
    // ...and getActionPlans clamps it, so a runaway trait can't explode the search.
    expect(Math.max(...moves(getActionPlans(acting(c, 9))).map((p) => p.cost))).toBe(MAX_PLANNED_ACTIONS);
  });
});

describe('move-then-attack', () => {
  const foe: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 5, y: 3 } };

  it('offers a chain that walks into contact and strikes', () => {
    const s = acting(config(20, [mover], [foe]), 2);
    const p = plain(getActionPlans(s), 'p1u0', 'attack');
    expect(p).toBeDefined();
    expect(p!.cost).toBe(2);
    expect(p!.steps.map((c) => c.type)).toEqual(['Move', 'Attack']);
    // It ends adjacent to the target, and that is what the preview marks.
    expect(makeHexGrid(s.board).distance(p!.to, foe.pos)).toBe(1);
  });

  it('does not move when it is already in contact', () => {
    const adjacent: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 3, y: 3 } };
    const s = acting(config(21, [mover], [adjacent]), 3);
    const p = plain(getActionPlans(s), 'p1u0', 'attack');
    expect(p!.cost).toBe(1);
    expect(p!.waypoints).toEqual([]);
    expect(p!.to).toEqual({ x: 2, y: 3 });
  });

  it('prefers high ground to approach from', () => {
    const board = { width: 11, height: 7, terrain: { '5,2': { elevation: 2 } } };
    const s = acting({ ...config(22, [mover], [foe]), board }, 2);
    expect(plain(getActionPlans(s), 'p1u0', 'attack')!.to).toEqual({ x: 5, y: 2 });
  });

  // (4,3) and (4,4) are the two nearest hexes bordering the target, and (4,3)
  // wins the plain tie-break. A flanker at (4,2) touches (4,3) but not (4,4).
  const flanker: UnitSpec = { name: 'Flanker', quality: 3, combat: 3, pos: { x: 4, y: 2 } };

  it('avoids an approach where a second standing foe would outnumber it', () => {
    const s = acting(config(23, [mover], [foe, flanker]), 2);
    expect(plain(getActionPlans(s), 'p1u0', 'attack')!.to).toEqual({ x: 4, y: 4 });
  });

  it('ignores a knocked-down flanker, which cannot outnumber anyone', () => {
    const s = acting(config(24, [mover], [foe, flanker]), 2);
    s.units.find((u) => u.id === 'p1u1')!.knockedDown = true;
    // Nothing outnumbers it now, so the nearest approach wins again.
    expect(plain(getActionPlans(s), 'p1u0', 'attack')!.to).toEqual({ x: 4, y: 3 });
  });
});

describe('spending the second action on the blow instead of the walk', () => {
  // The case that motivated all of this: three actions, a foe one move away.
  const foe: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 5, y: 3 } };

  it('offers both a two-action charge and a three-action power blow', () => {
    const plans = getActionPlans(acting(config(30, [mover], [foe]), 3));
    const cheap = plain(plans, 'p1u0', 'attack');
    const heavy = pressed(plans, 'p1u0', 'attack');

    expect(cheap!.cost).toBe(2); // move + attack, one action still in hand
    expect(cheap!.steps.map((c) => c.type)).toEqual(['Move', 'Attack']);

    expect(heavy!.cost).toBe(3); // move + power blow
    expect(heavy!.steps.map((c) => c.type)).toEqual(['Move', 'Attack']);
    expect((heavy!.steps[1] as Extract<Command, { type: 'Attack' }>).power).toBe(true);
  });

  it('offers both a two-action shot and a three-action aimed shot', () => {
    const archer = { ...mover, ranged: 4 };
    const target: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 9, y: 3 } };
    const plans = getActionPlans(acting(config(31, [archer], [target]), 3));
    expect(plain(plans, 'p1u0', 'shoot')!.cost).toBe(2);
    const aimed = pressed(plans, 'p1u0', 'shoot')!;
    expect(aimed.cost).toBe(3);
    expect((aimed.steps[aimed.steps.length - 1] as Extract<Command, { type: 'Shoot' }>).aimed).toBe(true);
  });

  it('withholds the power blow when the walk leaves too little', () => {
    const plans = getActionPlans(acting(config(32, [mover], [foe]), 2));
    expect(plain(plans, 'p1u0', 'attack')!.cost).toBe(2);
    expect(pressed(plans, 'p1u0', 'attack')).toBeUndefined();
  });

  it('still presses from where it stands when already in contact', () => {
    const adjacent: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 3, y: 3 } };
    const plans = getActionPlans(acting(config(33, [mover], [adjacent]), 2));
    expect(plain(plans, 'p1u0', 'attack')!.cost).toBe(1);
    expect(pressed(plans, 'p1u0', 'attack')!.cost).toBe(2);
  });

  it('walks the same way whichever blow is chosen', () => {
    // The two variants pick their approach independently, but cost leads the
    // tie-break, so they always settle on the same hex when both are affordable
    // — the menu asks about the blow, never about the route.
    const plans = getActionPlans(acting(config(34, [mover], [foe]), 3));
    const cheap = plain(plans, 'p1u0', 'attack')!;
    const heavy = pressed(plans, 'p1u0', 'attack')!;
    expect(heavy.to).toEqual(cheap.to);
    expect(heavy.waypoints).toEqual(cheap.waypoints);
    expect(heavy.cost).toBe(cheap.cost + 1);
  });

  it('drops the power blow when only the plain one fits the walk', () => {
    // Two moves out: the charge fits three actions (2 + 1), the power blow does
    // not (2 + 2), and no nearer approach exists to fall back on.
    const distant: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 9, y: 3 } };
    const plans = getActionPlans(acting(config(35, [mover], [distant]), 3));
    expect(plain(plans, 'p1u0', 'attack')!.cost).toBe(3);
    expect(pressed(plans, 'p1u0', 'attack')).toBeUndefined();
  });
});

describe('move-then-shoot', () => {
  it('steps aside to clear a lane a friend is blocking', () => {
    const archer: UnitSpec = { name: 'Archer', quality: 3, combat: 3, move: 3, ranged: 8, pos: { x: 2, y: 3 } };
    const blocker: UnitSpec = { name: 'Blocker', quality: 3, combat: 3, pos: { x: 3, y: 3 } };
    const target: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 4, y: 3 } };

    // Standing still, the friend is in the way.
    const one = getActionPlans(acting(config(40, [archer, blocker], [target]), 1));
    expect(plain(one, 'p1u0', 'shoot')).toBeUndefined();

    // With a second action it can sidestep and fire.
    const two = getActionPlans(acting(config(40, [archer, blocker], [target]), 2));
    const shot = plain(two, 'p1u0', 'shoot');
    expect(shot).toBeDefined();
    expect(shot!.cost).toBe(2);
    expect(shot!.steps.map((c) => c.type)).toEqual(['Move', 'Shoot']);
  });

  it('never chooses a firing hex in contact with a living enemy', () => {
    const archer: UnitSpec = { name: 'Archer', quality: 3, combat: 3, move: 4, ranged: 8, pos: { x: 1, y: 3 } };
    const target: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 6, y: 3 } };
    const s = acting(config(41, [archer], [target]), 3);
    const board = makeHexGrid(s.board);
    for (const p of getActionPlans(s).filter((x) => x.kind === 'shoot')) {
      expect(board.distance(p.to, target.pos)).toBeGreaterThan(1);
    }
  });

  it('does not let the vacated start hex block its own lane', () => {
    // Moving along the firing line: the hex the archer left must not count.
    const archer: UnitSpec = { name: 'Archer', quality: 3, combat: 3, move: 1, ranged: 8, pos: { x: 2, y: 3 } };
    const target: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 7, y: 3 } };
    const s = acting(config(42, [archer], [target]), 2);
    const shot = plain(getActionPlans(s), 'p1u0', 'shoot')!;
    expect(shot.cost).toBe(1); // already in range and sighted, so it just shoots
    expect(shot.waypoints).toEqual([]);
  });

  it('offers no move-then-shoot with a single action', () => {
    const archer: UnitSpec = { name: 'Archer', quality: 3, combat: 3, move: 3, ranged: 3, pos: { x: 1, y: 3 } };
    const target: UnitSpec = { name: 'Foe', quality: 3, combat: 3, pos: { x: 8, y: 3 } };
    const s = acting(config(43, [archer], [target]), 1);
    expect(getActionPlans(s).some((p) => p.kind === 'shoot')).toBe(false);
  });
});
