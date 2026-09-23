import type { Board } from './board.js';
import { rollD6 } from './rng.js';
import { aliveUnits, livingCount } from './query.js';
import type { GameEvent, GameState, Owner, Unit } from './types.js';

/**
 * Morale. Beyond the activation turnover, casualties shake the survivors:
 *
 *  - **Fear** — when a unit suffers a *gruesome* kill in combat (the winner
 *    tripled its score), every friend within {@link MORALE_RADIUS} must pass a
 *    nerve check (a d6 ≥ its Quality) or be knocked down. An ordinary kill
 *    shakes no one.
 *  - **Rout** — the first time a warband is ground down to a third of its
 *    starting strength it *breaks*: every survivor takes a nerve check, and each
 *    that fails flees the field (removed from play). It happens once per side.
 *
 * All of this is deterministic (it draws from the state's RNG) and pushes new
 * events, so it replays exactly and is fully unit-testable.
 */

/**
 * Friends within this board-distance radius of a gruesome casualty must test
 * nerve: a "long" reach, half again the baseline move of 3.
 */
export const MORALE_RADIUS = 4;

/** A warband breaks when its living count falls to this fraction of its start. */
export const ROUT_FRACTION = 1 / 3;

/** Roll one nerve check for a unit, record it, and report whether it passed. */
function nerveCheck(s: GameState, events: GameEvent[], unit: Unit): boolean {
  const roll = rollD6(s.rngState);
  s.rngState = roll.state;
  const passed = roll.die >= unit.quality;
  events.push({ type: 'NerveCheck', unitId: unit.id, quality: unit.quality, die: roll.die, passed });
  return passed;
}

/**
 * Resolve the morale fallout of a combat casualty: after a `gruesome` kill,
 * nearby friends test nerve (fear); then, for any kill, the casualty's warband
 * tests for a rout if it has just crossed the break threshold. Mutates `s` and
 * appends events. Rout removals never trigger further fear, so the cascade is
 * bounded.
 */
export function resolveCombatMorale(
  s: GameState,
  events: GameEvent[],
  victim: Unit,
  board: Board,
  gruesome: boolean,
): void {
  if (gruesome) fearCheck(s, events, victim, board);
  routCheck(s, events, victim.owner);
}

function fearCheck(s: GameState, events: GameEvent[], victim: Unit, board: Board): void {
  for (const u of aliveUnits(s, victim.owner)) {
    if (u.id === victim.id || u.knockedDown) continue;
    if (board.distance(u.pos, victim.pos) > MORALE_RADIUS) continue;
    if (!nerveCheck(s, events, u)) {
      u.knockedDown = true;
      events.push({ type: 'UnitKnockedDown', unitId: u.id });
    }
  }
}

/**
 * The living count at or below which `owner`'s warband breaks (see
 * {@link ROUT_FRACTION}). Exported so a UI can warn a player how close to
 * collapse a side is without re-deriving the rule.
 */
export function routThreshold(state: GameState, owner: Owner): number {
  return Math.floor(state.startCount[owner] * ROUT_FRACTION);
}

function routCheck(s: GameState, events: GameEvent[], owner: Owner): void {
  if (s.broken[owner]) return;
  const start = s.startCount[owner];
  if (start <= 0 || livingCount(s, owner) > routThreshold(s, owner)) return;

  s.broken[owner] = true;
  events.push({ type: 'WarbandBroken', player: owner });

  // Snapshot the survivors first: those that flee are removed as we go, but a
  // routing unit does not itself spread fear.
  for (const u of aliveUnits(s, owner)) {
    if (!nerveCheck(s, events, u)) {
      u.dead = true;
      u.knockedDown = false;
      events.push({ type: 'UnitRouted', unitId: u.id });
    }
  }
}
