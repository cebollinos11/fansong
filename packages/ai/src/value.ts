import { combatOdds, isKing, isPig, type Board, type GameState, type Unit, type Vec } from '@fansong/engine';

/** Traits that make a unit worth more to keep (or to kill), each counted once. */
const VALUED_TRAITS = [
  'fast', 'tough', 'guard', 'big', 'flying', 'reassembling', 'opportunist',
  'savage', 'leader', 'armored', 'sharpshooter', 'mastery',
  'shieldwall', 'rusher', 'slippery', 'whirling', 'immovable', 'woodwise', 'trample',
] as const;

/**
 * Rough worth of a unit, after the point-buy formula: Combat and traits,
 * scaled by how reliably it activates (lower Quality is better).
 */
function unitValue(u: Unit): number {
  let traits = u.traits.ranged > 0 ? 1 : 0;
  for (const t of VALUED_TRAITS) if (u.traits[t]) traits++;
  return ((u.combat + 1 + traits * 0.6) * (7 - u.quality)) / 4;
}

/** What a King is worth in kill-the-king, in {@link unitValue} terms: the game rides on it. */
const KING_WORTH = 30;

/** {@link unitValue}, except that a King — or the golden Pig — is worth the game. */
export function worthOf(state: GameState, u: Unit): number {
  return isKing(state, u.id) || isPig(state, u.id) ? KING_WORTH : unitValue(u);
}

/** How one blow or shot is likely to go, and what each way is worth in {@link worthOf} terms. */
export interface BlowOutcome {
  /** The chance the target is killed outright. */
  kill: number;
  /** The chance of a lesser hit: the target knocked down or pushed. */
  hurt: number;
  /** The chance the attacker is hurt instead. */
  lose: number;
  killWorth: number;
  hurtWorth: number;
  lossWorth: number;
}

/**
 * The exact odds of a blow or shot by `attacker` on `target`, and the worth of
 * each outcome: a kill is the target's whole worth (a Tough save turns it into a
 * knockdown), a lesser hit — knocked down or pushed — a share of it, and a lost
 * melee costs a share of the attacker's: a larger one than the lesser hit, for
 * the friends it leaves exposed, unless `even` (see {@link blowValue}).
 */
export function blowOutcome(
  state: GameState,
  board: Board,
  attacker: Unit,
  target: Unit,
  pressed: boolean,
  ranged: boolean,
  from?: Vec,
  even = false,
): BlowOutcome {
  const odds = combatOdds(state, attacker.id, target.id, { pressed, ranged, from, board });
  const at = from ?? attacker.pos;
  const vt = worthOf(state, target);
  const killWorth = target.traits.tough && !target.knockedDown ? vt * 0.5 : vt;
  // A push off the map is a kill: about half of a lesser win or loss is a push.
  const hurtWorth = edgeBehind(board, target.pos, at) ? (killWorth + vt * 0.3) / 2 : vt * 0.3;
  const lossWorth = worthOf(state, attacker) * (!ranged && edgeBehind(board, at, target.pos) ? 0.7 : even ? 0.3 : 0.4);
  return { kill: odds.kill, hurt: odds.win - odds.kill, lose: odds.lose, killWorth, hurtWorth, lossWorth };
}

/**
 * What a blow or shot by `attacker` on `target` is worth, from its
 * {@link blowOutcome}. A single swing with a second action behind it counts
 * that follow-up too, so it compares fairly against a pressed one.
 *
 * `even` weighs a lost exchange as no more than the lesser hit it is: the view
 * of a unit with no friend left for its fall to expose.
 */
export function blowValue(
  state: GameState,
  board: Board,
  attacker: Unit,
  target: Unit,
  pressed: boolean,
  ranged: boolean,
  from?: Vec,
  actions = state.actionsRemaining,
  even = false,
): number {
  const o = blowOutcome(state, board, attacker, target, pressed, ranged, from, even);
  const ev = o.kill * o.killWorth + o.hurt * o.hurtWorth - o.lose * o.lossWorth;
  return !pressed && actions >= 2 ? ev * 1.8 : ev;
}

/** Whether a unit at `at` pushed back by a foe at `by` would go off the edge of the map. */
export function edgeBehind(board: Board, at: Vec, by: Vec): boolean {
  return !board.inBounds(board.stepAway(by, at));
}

/** The chance a die against `quality` comes up a success. */
export const successChance = (quality: number) => Math.min(1, Math.max(0, (7 - quality) / 6));

/** The chance of each number of successes on `dice` dice against `quality`, the first a sure one when `inspired`. */
export function successOdds(quality: number, dice: number, inspired: boolean): number[] {
  const p = successChance(quality);
  const sure = inspired ? 1 : 0;
  const rolled = dice - sure;
  const odds = new Array<number>(dice + 1).fill(0);
  for (let hits = 0; hits <= rolled; hits++) odds[hits + sure] = binomial(rolled, hits) * p ** hits * (1 - p) ** (rolled - hits);
  return odds;
}

export function binomial(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
