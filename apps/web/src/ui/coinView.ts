import type { GameState, Owner, Unit } from '@fansong/engine';
import { sideName, type SideNames } from './sides.js';

// The coin toss that opens a battle, as the screen needs it: who won it (the
// engine has already decided, from the seed), which figure each side is struck
// on the coin as, and what the banner says. Pure, so the wording and the choice
// of champion are unit-testable.

/** What the board needs to toss the coin: the winner, and each side's champion. */
export interface CoinTossView {
  /** The side that won the toss and leads round 1. */
  winner: Owner;
  /** The unit name struck on each side's face (a `UNIT_SPRITES` key). */
  champions: [string, string];
  /** What each side is called, engraved on its face. */
  names: SideNames;
}

/**
 * The unit that stands for a side on its face of the coin: its Leader, else its
 * King, else its best fighter (the highest Combat, and of those the steadiest
 * nerve). Falls back to the first unit on the roster, and to null for a side
 * with nobody on the table at all.
 */
export function championOf(state: GameState, owner: Owner): Unit | null {
  const mine = state.units.filter((u) => u.owner === owner && !u.dead);
  if (mine.length === 0) return null;
  const king = state.mode?.mode === 'kill-the-king' ? state.mode.kings?.[owner] : undefined;
  return (
    mine.find((u) => u.traits.leader) ??
    mine.find((u) => u.id === king) ??
    mine.reduce((best, u) => (u.combat > best.combat || (u.combat === best.combat && u.quality < best.quality) ? u : best))
  );
}

/** The figure a unit is drawn as, which is what the coin is struck with. */
function lookOf(unit: Unit | null, fallback: string): string {
  return unit?.look ?? unit?.name ?? fallback;
}

/** The toss to play for a match about to start, read off its opening state. */
export function coinTossView(state: GameState, names: SideNames): CoinTossView {
  return {
    winner: state.initiativeLeader,
    champions: [lookOf(championOf(state, 0), names[0]), lookOf(championOf(state, 1), names[1])],
    names,
  };
}

/** What the toss banner says while the coin is in the air, and once it has landed. */
export function tossWords(toss: CoinTossView): { call: string; verdict: string } {
  const name = sideName(toss.names, toss.winner, true);
  return {
    call: 'The coin is in the air',
    // "You begin", but an army is one thing whatever its name: "Iron Wardens begins".
    verdict: `${name} ${name === 'You' ? 'begin' : 'begins'}!`,
  };
}
