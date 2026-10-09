import { describe, expect, it } from 'vitest';
import {
  createGame,
  getLegalCommands,
  hashGameState,
  recordReplay,
  reduce,
  runReplay,
  type GameConfig,
  type GameMode,
  type GameState,
  type UnitSpec,
  type Vec,
} from '@fansong/engine';
import { chooseCommand } from '../src/index.js';

const U = (name: string, x: number, y: number, extra: Partial<UnitSpec> = {}): UnitSpec => ({
  name,
  quality: 3,
  combat: 3,
  pos: { x, y },
  ...extra,
});

const WIDTH = 14;
const HEIGHT = 10;
const rows = Array.from({ length: HEIGHT }, (_, y) => y);
const ZONE: Vec[] = [0, 1].flatMap((x) => rows.map((y) => ({ x, y })));
const block = (x0: number, y0: number): Vec[] => [0, 1].flatMap((dx) => [0, 1].map((dy) => ({ x: x0 + dx, y: y0 + dy })));

function config(seed: number, mode: GameMode | undefined, zones: boolean): GameConfig {
  const c: GameConfig = {
    seed,
    board: { width: WIDTH, height: HEIGHT },
    warbands: [
      [U('Chief', 1, 4, { leader: true, king: true }), U('Spear', 1, 2), U('Axe', 1, 6), U('Bow', 0, 5, { ranged: 4 })],
      [U('Boss', 12, 4, { leader: true, king: true }), U('Raider', 12, 2), U('Brute', 12, 6), U('Slinger', 13, 5, { ranged: 4 })],
    ],
  };
  if (mode) c.mode = mode;
  if (mode === 'king-of-the-hill') c.objectives = { hill: block(6, 4) };
  if (mode === 'conquest') c.objectives = { conquest: [block(6, 1), block(6, 4), block(6, 7)] };
  if (zones) c.retreatZones = [ZONE, ZONE.map((v) => ({ x: WIDTH - 1 - v.x, y: v.y }))];
  return c;
}

const MODES: (GameMode | undefined)[] = [undefined, 'kill-the-king', 'king-of-the-hill', 'conquest'];

/** Put `unitId` mid-activation with `actions` actions (no dice, so no luck involved). */
function activate(s: GameState, unitId: string, actions = 3): GameState {
  const next = structuredClone(s);
  next.units.find((u) => u.id === unitId)!.activatedThisRound = true;
  return { ...next, phase: 'acting', activeUnitId: unitId, actionsRemaining: actions, activationCount: 1 };
}

describe('AI and the retreat', () => {
  it('never sounds the retreat, even as its only way to act', () => {
    // Alone, far from any foe it could reach: the call is on offer, and declined.
    const s = activate(createGame(config(1, undefined, true)), 'p0u0', 1);
    expect(getLegalCommands(s)).toContainEqual({ type: 'Retreat', unitId: 'p0u0' });
    expect(chooseCommand(s).type).not.toBe('Retreat');
  });

  it('plays the very same game whether or not retreat zones are on offer, in every mode', () => {
    for (const mode of MODES) {
      for (let seed = 1; seed <= 6; seed++) {
        const plain = recordReplay(config(seed, mode, false), chooseCommand);
        const zoned = recordReplay(config(seed, mode, true), chooseCommand);
        expect(zoned.commands).toEqual(plain.commands);
        expect(zoned.commands.some((c) => c.type === 'Retreat')).toBe(false);
        // The states differ only by the zones they carry.
        const { retreatZones, ...rest } = runReplay(zoned).final;
        expect(retreatZones).toBeDefined();
        expect(hashGameState(rest as GameState)).toBe(hashGameState(runReplay(plain).final));
      }
    }
  });

  it('keeps coming after a side that is walking off, in the zone modes too', () => {
    for (const mode of ['conquest', 'king-of-the-hill'] as const) {
      // Player 0 has called the retreat and its troops stand still by the flag;
      // the AI, playing 1, must close in rather than sit on its zones.
      let s = createGame(config(3, mode, true));
      s = reduce(activate(s, 'p0u0', 1), { type: 'Retreat', unitId: 'p0u0' }).state;
      const gap = (state: GameState): number =>
        Math.min(...state.units.filter((u) => u.owner === 1 && !u.dead).map((u) => u.pos.x)) -
        Math.max(...state.units.filter((u) => u.owner === 0 && !u.dead).map((u) => u.pos.x));
      const before = gap(s);
      let attacked = false;
      for (let step = 0; step < 4000 && s.phase !== 'gameOver' && !attacked; step++) {
        // Player 0 only passes: it activates on one die and ends at once.
        const command =
          s.active === 1
            ? chooseCommand(s)
            : (getLegalCommands(s).find((c) => c.type === 'EndActivation') ?? getLegalCommands(s).find((c) => c.type === 'ChooseActivation')!);
        if (s.active === 1 && command.type === 'Attack') attacked = true;
        s = reduce(s, command).state;
      }
      // It scores, or it closes to blows: either way the walkers are not left in peace.
      expect(attacked || s.phase === 'gameOver' || gap(s) < before).toBe(true);
    }
  });
});
