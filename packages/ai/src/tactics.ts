import {
  airborne,
  aliveUnits,
  enemiesOf,
  inMelee,
  maxActivationDice,
  unitById,
  unitMove,
  vecKey,
  type Board,
  type GameState,
  type Owner,
  type Unit,
  type Vec,
} from '@fansong/engine';
import { blowOutcome, successOdds, worthOf } from './value.js';

/**
 * Tactics: what a position is worth, read from the engine's own odds.
 *
 * {@link threat} is what a side's units can expect to do to the enemy from
 * where everyone stands, and {@link exposure} is the same seen from the other
 * side. A move is then worth the threat it adds less the exposure it adds
 * ({@link MoveSetup}). The odds already count pincers, outnumbering,
 * shieldwalls, high ground and every trait, so stepping behind a foe a friend
 * is fighting scores for the friend's better blow with no rule saying so.
 *
 * Nothing here rolls dice or calls `reduce`: a hypothetical position is the
 * same state with one unit somewhere else ({@link withUnitAt}).
 */

/** `state` with `unitId` standing on `pos` and nothing else changed: a position to score, never to play. */
export function withUnitAt(state: GameState, unitId: string, pos: Vec): GameState {
  return { ...state, units: state.units.map((u) => (u.id === unitId ? { ...u, pos: { x: pos.x, y: pos.y } } : u)) };
}

/** What a blow a unit can only strike next round is worth against one it can strike in this one. */
const NEXT_ROUND = 0.5;

/** One unit's blow on one target, already weighed by the chance it gets the actions for it. */
interface Blow {
  /** The chance it kills. */
  kill: number;
  /** Worth of its lesser hits less what losing the exchange costs, in {@link worthOf} terms. */
  rest: number;
  /** The hex a charge would be struck from. */
  from?: Vec;
}

type Occupied = (v: Vec) => boolean;

/** The chance of at least so many successes, by Quality, the successes needed and whether inspired. */
const atLeast = new Map<number, number>();

/**
 * The chance `unit` gets `need` actions the next time it activates, on the two
 * dice the AI usually rolls (three when the blow needs them all). A unit that
 * has gone this round, is going now or is benched only acts in the next one,
 * at a discount.
 */
function actionOdds(state: GameState, unit: Unit, need: number): number {
  const dice = Math.max(need, 2);
  if (dice > maxActivationDice(unit)) return 0;
  const key = (unit.quality * 4 + need) * 2 + (unit.inspired ? 1 : 0);
  let p = atLeast.get(key);
  if (p === undefined) {
    const odds = successOdds(unit.quality, dice, unit.inspired);
    p = 0;
    for (let n = need; n <= dice; n++) p += odds[n]!;
    atLeast.set(key, p);
  }
  const waits = unit.activatedThisRound || unit.id === state.activeUnitId || state.benched[unit.owner];
  return waits ? p * NEXT_ROUND : p;
}

/**
 * The hex `attacker` would charge `target` from: the free hex beside the
 * target nearest to it, within one Move. A bound by distance, not a walk: it
 * takes no account of rock in the way or of foes that would stop the charge.
 */
function chargeHex(state: GameState, board: Board, occupied: Occupied, attacker: Unit, target: Unit): Vec | undefined {
  const move = unitMove(attacker);
  const flies = airborne(state, attacker);
  let best: Vec | undefined;
  let bestDist = move + 1;
  for (const h of board.neighbors(target.pos)) {
    const d = board.distance(attacker.pos, h);
    if (d >= bestDist || occupied(h) || (!flies && board.isDeadly(h))) continue;
    best = h;
    bestDist = d;
  }
  return best;
}

/**
 * The blow `attacker` can bring against `target` from where both stand in
 * `state`: a strike in contact (one action), a shot within range and sight
 * (one action), or a charge within one Move (two actions). A unit locked in
 * melee only threatens the foes it is in contact with; one on the ground needs
 * an action more to stand. `undefined` when it can't reach.
 */
function blowOn(state: GameState, board: Board, occupied: Occupied, attacker: Unit, target: Unit): Blow | undefined {
  if (attacker.transfixedBy !== undefined) return undefined;
  const d = board.distance(attacker.pos, target.pos);
  let need = attacker.knockedDown ? 2 : 1;
  let ranged = false;
  let from: Vec | undefined;
  if (d > 1) {
    const range = attacker.traits.ranged;
    if (d > Math.max(range, unitMove(attacker) + 1)) return undefined;
    if (inMelee(state, attacker, board)) return undefined;
    if (d <= range && board.lineOfSight(attacker.pos, target.pos, occupied)) {
      ranged = true;
    } else {
      from = chargeHex(state, board, occupied, attacker, target);
      if (!from) return undefined;
      need++;
    }
  }
  const p = actionOdds(state, attacker, need);
  if (p <= 0) return undefined;
  const o = blowOutcome(state, board, attacker, target, false, ranged, from);
  const rest = o.hurt * o.hurtWorth - o.lose * o.lossWorth;
  // An exchange it would lose by is one it does not make: within reach, worth nothing.
  const worthIt = o.kill * o.killWorth + rest > 0;
  return { kill: worthIt ? p * o.kill : 0, rest: worthIt ? p * rest : 0, ...(from ? { from } : {}) };
}

/**
 * What `blows` are worth together against `target`. The kills are not summed:
 * the target dies once, so three units that can each kill it are worth the
 * chance that any of them does. That is what rewards a second unit joining a
 * fight without letting everyone claim the same kill in full.
 */
function targetValue(state: GameState, target: Unit, blows: (Blow | undefined)[]): number {
  const worth = worthOf(state, target);
  const killWorth = target.traits.tough && !target.knockedDown ? worth * 0.5 : worth;
  let survives = 1;
  let rest = 0;
  for (const b of blows) {
    if (!b) continue;
    survives *= 1 - b.kill;
    rest += b.rest;
  }
  return Math.max(0, killWorth * (1 - survives) + rest);
}

function occupiedBy(state: GameState): Occupied {
  const keys = new Set<string>();
  for (const u of state.units) if (!u.dead) keys.add(vecKey(u.pos));
  return (v) => keys.has(vecKey(v));
}

/**
 * What `side`'s units can expect to do to the enemy from where everyone
 * stands: per enemy unit, the blows `side` can bring against it, each weighed
 * by the odds its unit gets the actions for it, and combined per target.
 */
export function threat(state: GameState, board: Board, side: Owner): number {
  const occupied = occupiedBy(state);
  const ours = aliveUnits(state, side);
  let total = 0;
  for (const target of enemiesOf(state, side)) {
    total += targetValue(state, target, ours.map((u) => blowOn(state, board, occupied, u, target)));
  }
  return total;
}

/** What the enemy can expect to do to `side`: {@link threat} seen from the other side. */
export function exposure(state: GameState, board: Board, side: Owner): number {
  return threat(state, board, side === 0 ? 1 : 0);
}

/** What activating a unit now is worth to the order of play, in {@link worthOf} terms (see {@link activationOrder}). */
export interface Standing {
  /** The best blow it can strike itself from where it stands. */
  own: number;
  /** The most that stepping up to a foe adds to what its friends can do to that foe. */
  gift: number;
  /** The most its own best blow would gain if a friend still to go stepped up first. */
  wait: number;
}

/**
 * Who should go before whom, for every unit of `side` still to activate: the
 * one that sets a blow up goes before the one that strikes it.
 *
 * A unit's `gift` is what the blows of its friends still to go gain on a foe
 * when it comes to stand beside that foe, outnumbering it or closing a pincer;
 * the friend whose blow gains has that much to `wait` for. A friend that has
 * gone this round strikes next round whoever goes first now, so it is left out.
 *
 * Only a unit free to step into contact, a foe within its charge reach (a
 * distance bound, as {@link chargeHex}) and the friends with a blow on that
 * same foe are looked at, and of the hexes beside the foe only the nearest and
 * those that close a pincer: outnumbering is the same from any of them. So a
 * warband with no one near the enemy costs next to nothing.
 */
export function activationOrder(state: GameState, board: Board, side: Owner): Map<string, Standing> {
  const taken = new Set<string>();
  for (const u of state.units) if (!u.dead) taken.add(vecKey(u.pos));
  // The setter's hex as it leaves it and the one it takes, for the position being scored.
  let left = '';
  let entered = '';
  const occupied: Occupied = (v) => {
    const key = vecKey(v);
    return key === entered || (key !== left && taken.has(key));
  };
  const ours: Unit[] = [];
  for (const u of aliveUnits(state, side)) if (!u.activatedThisRound) ours.push(u);
  const theirs = enemiesOf(state, side);
  const n = ours.length;
  const m = theirs.length;
  const killWorths: number[] = [];
  for (const target of theirs) {
    const worth = worthOf(state, target);
    killWorths.push(target.traits.tough && !target.knockedDown ? worth * 0.5 : worth);
  }
  const blows = new Array<Blow | undefined>(n * m).fill(undefined);
  /** By target, the units with a blow on it. */
  const reach: number[][] = [];
  const own = new Array<number>(n).fill(0);
  const gift = new Array<number>(n).fill(0);
  const wait = new Array<number>(n).fill(0);
  for (let t = 0; t < m; t++) {
    const striking: number[] = [];
    for (let i = 0; i < n; i++) {
      const blow = blowOn(state, board, occupied, ours[i]!, theirs[t]!);
      if (!blow) continue;
      blows[i * m + t] = blow;
      striking.push(i);
      const value = blow.kill * killWorths[t]! + blow.rest;
      if (value > own[i]!) own[i] = value;
    }
    reach.push(striking);
  }

  const scratch: (Blow | undefined)[] = [];
  const hexes: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const setter = ours[i]!;
    // A shooter or a spellcaster keeps its distance: it never steps up to a foe to help a friend.
    if (setter.transfixedBy !== undefined || setter.traits.ranged >= 2 || setter.traits.magicUser) continue;
    // It has to get the action to move (two from the ground), and be free to: leaving a melee costs a free hack.
    const p = actionOdds(state, setter, setter.knockedDown ? 2 : 1);
    if (p <= 0) continue;
    const move = unitMove(setter);
    const flies = airborne(state, setter);
    let pinned: boolean | undefined;
    for (let t = 0; t < m; t++) {
      const striking = reach[t]!;
      if (striking.length === 0 || (striking.length === 1 && striking[0] === i)) continue;
      const target = theirs[t]!;
      const d = board.distance(setter.pos, target.pos);
      if (d < 2 || d > move + 1) continue;
      if ((pinned ??= inMelee(state, setter, board))) break;
      left = vecKey(setter.pos);
      entered = '';
      // Where it would stand: the nearest free hex beside the foe, and straight across the foe from each friend in contact.
      hexes.length = 0;
      const nearest = chargeHex(state, board, occupied, setter, target);
      if (nearest) hexes.push(nearest);
      scratch.length = 0;
      for (const j of striking) {
        if (j === i) continue;
        scratch.push(blows[j * m + t]);
        const friend = ours[j]!;
        if (board.distance(friend.pos, target.pos) !== 1) continue;
        const across = board.stepAway(friend.pos, target.pos);
        if (nearest && across.x === nearest.x && across.y === nearest.y) continue;
        if (!board.inBounds(across) || board.distance(setter.pos, across) > move || occupied(across)) continue;
        if (!flies && board.isDeadly(across)) continue;
        hexes.push(across);
      }
      const before = targetValue(state, target, scratch);
      for (const hex of hexes) {
        entered = vecKey(hex);
        const moved = withUnitAt(state, setter.id, hex);
        scratch.length = 0;
        for (const j of striking) {
          if (j === i) continue;
          const blow = blowOn(moved, board, occupied, ours[j]!, target);
          scratch.push(blow);
          if (!blow) continue;
          const gain = p * (blow.kill * killWorths[t]! + blow.rest - own[j]!);
          if (gain > wait[j]!) wait[j] = gain;
        }
        const gain = p * (targetValue(state, target, scratch) - before);
        if (gain > gift[i]!) gift[i] = gain;
      }
      left = entered = '';
    }
  }

  const order = new Map<string, Standing>();
  for (let i = 0; i < n; i++) order.set(ours[i]!.id, { own: own[i]!, gift: gift[i]!, wait: wait[i]! });
  return order;
}

const sameBlow = (a: Blow | undefined, b: Blow | undefined): boolean => a === b || (!!a && !!b && a.kill === b.kill && a.rest === b.rest);

/** A destination as a position: the state with the mover there, the mover in it, and which hexes are taken. */
interface Arrival {
  moved: GameState;
  there: Unit;
  occupied: Occupied;
  /** Whether the mover is locked in melee there; worked out when first asked for. */
  pinned?: boolean;
}

/**
 * The change a move of the active unit makes to its side's {@link threat} and
 * {@link exposure}, for every hex it could go to.
 *
 * {@link delta} gives what `threat(withUnitAt(...)) - threat(state)` would,
 * without scoring the whole board again for each hex. The blows of the
 * position as it stands are worked out once. For a destination, only those the
 * move could change are worked out again: the mover's own, those against it,
 * and those by or against a unit it comes to stand near. The blows that change
 * only because it left its hex are the same wherever it goes, so they too are
 * worked out once, as is each charge of its own from a given hex.
 *
 * The costliest part, what the enemy can do to the mover itself where it ends
 * up ({@link risk}), is kept apart from the rest ({@link partial}) and is never
 * negative, so a caller can rank the moves by the rest and only ask for the
 * risk of those that could still be the best.
 */
export class MoveSetup {
  private readonly units: Unit[];
  private readonly n: number;
  /** Indices into {@link units}: the mover, its side (itself included) and the enemy. */
  private readonly me: number;
  private readonly ours: number[] = [];
  private readonly theirs: number[] = [];
  private readonly taken: Set<string>;
  private readonly occupied: Occupied = (v) => this.taken.has(vecKey(v));
  /** Every unit's distance from the mover's hex. */
  private readonly fromHere: number[];
  /** Distances between units, by pair (see {@link pair}); 0 until asked for. */
  private readonly apart: number[];
  /** Blows as things stand, by pair. */
  private readonly base: (Blow | undefined)[];
  private readonly baseKnown: boolean[];
  /** Blows with the mover gone from its hex and nowhere near, by pair. */
  private readonly gone: (Blow | undefined)[];
  private readonly goneKnown: boolean[];
  /** Whether the mover leaving its hex could change the pair's blow: 0 until asked for, then 1 or 2 (no). */
  private readonly leaves: number[];
  /** The mover's own blows, by target and the hex it strikes or shoots from. */
  private readonly own = new Map<string, Blow | undefined>();
  /** What each unit is threatened with as things stand. */
  private readonly values: (number | undefined)[];
  /**
   * By target, the attackers other than the mover whose blow on it the move
   * could change: those with a blow as things stand, or that the mover leaving
   * its hex could give one. Coming near never gives a unit a blow it lacked.
   */
  private live: number[][] | undefined;
  private here: number | undefined;
  private readonly arrivals = new Map<string, Arrival>();
  /** Every unit's distance from the destination being scored. */
  private readonly fromThere: number[];
  private readonly scratch: (Blow | undefined)[] = [];

  private readonly board: Board;

  constructor(
    private readonly state: GameState,
    board: Board,
    private readonly mover: Unit,
  ) {
    // The hexes round a unit are asked for again for every destination: look each up once.
    const round = new Map<string, Vec[]>();
    this.board = {
      ...board,
      neighbors: (v) => {
        const key = vecKey(v);
        let hexes = round.get(key);
        if (!hexes) round.set(key, (hexes = board.neighbors(v)));
        return hexes;
      },
    };
    const units = (this.units = aliveUnits(state));
    const n = (this.n = units.length);
    this.me = units.findIndex((u) => u.id === mover.id);
    units.forEach((u, i) => (u.owner === mover.owner ? this.ours : this.theirs).push(i));
    this.taken = new Set(units.map((u) => vecKey(u.pos)));
    this.fromHere = units.map((u) => board.distance(u.pos, mover.pos));
    this.fromThere = new Array<number>(n).fill(0);
    this.apart = new Array<number>(n * n).fill(0);
    this.base = new Array<Blow | undefined>(n * n).fill(undefined);
    this.baseKnown = new Array<boolean>(n * n).fill(false);
    this.gone = new Array<Blow | undefined>(n * n).fill(undefined);
    this.goneKnown = new Array<boolean>(n * n).fill(false);
    this.leaves = new Array<number>(n * n).fill(0);
    this.values = new Array<number | undefined>(n).fill(undefined);
  }

  private pair(attacker: number, target: number): number {
    return attacker * this.n + target;
  }

  /** The blow of unit `a` on unit `t` as things stand. */
  private baseBlow(a: number, t: number): Blow | undefined {
    const k = this.pair(a, t);
    if (!this.baseKnown[k]) {
      this.baseKnown[k] = true;
      this.base[k] = blowOn(this.state, this.board, this.occupied, this.units[a]!, this.units[t]!);
    }
    return this.base[k];
  }

  /**
   * Whether the mover standing on `at` could change the blow of unit `a` on
   * unit `t` (neither of them the mover), given how far each is from `at`. It
   * has to be near enough to matter. Beside the target, it outnumbers it,
   * closes a pincer on it, braces it, backs it against a push, or takes the hex
   * a charge would come from. Beside an enemy attacker, or beside the hex that
   * attacker would charge to, it outnumbers it or pins it in melee. In the lane
   * of a shot, it blocks or covers.
   */
  private touches(a: number, t: number, at: Vec, toAttacker: number, toTarget: number): boolean {
    if (toTarget <= 1) return true;
    const attacker = this.units[a]!;
    if (attacker.owner !== this.mover.owner) {
      if (toAttacker <= 1) return true;
      // The hex a charge comes from is beside its target, so the mover is only beside it within two of the target.
      if (toTarget === 2) {
        const from = this.baseBlow(a, t)?.from;
        if (from && this.board.distance(from, at) <= 1) return true;
      }
    }
    const range = attacker.traits.ranged;
    if (range < 2 || toAttacker === 0 || toTarget === 0) return false;
    const k = this.pair(a, t);
    const d = (this.apart[k] ||= this.board.distance(attacker.pos, this.units[t]!.pos));
    return d >= 2 && d <= range && toAttacker + toTarget <= d + 1;
  }

  /** Whether the mover leaving its hex could change the blow of unit `a` on unit `t`. */
  private leaving(a: number, t: number): boolean {
    const k = this.pair(a, t);
    return (this.leaves[k] ||= this.touches(a, t, this.mover.pos, this.fromHere[a]!, this.fromHere[t]!) ? 1 : 2) === 1;
  }

  private arrival(to: Vec): Arrival {
    const toKey = vecKey(to);
    let arrival = this.arrivals.get(toKey);
    if (!arrival) {
      const moved = withUnitAt(this.state, this.mover.id, to);
      const here = vecKey(this.mover.pos);
      arrival = {
        moved,
        there: unitById(moved, this.mover.id)!,
        occupied: (v) => {
          const key = vecKey(v);
          return key === toKey || (key !== here && this.taken.has(key));
        },
      };
      this.arrivals.set(toKey, arrival);
    }
    return arrival;
  }

  /**
   * The mover's own blow on unit `t` from `to`. Its odds depend on the hex it
   * is struck from and on nothing else about the mover, so a charge from one
   * hex is worked out once for every destination it can be made from.
   */
  private ownBlow(to: Vec, t: number): Blow | undefined {
    const { board, mover } = this;
    const target = this.units[t]!;
    const d = this.fromThere[t]!;
    if (d > Math.max(mover.traits.ranged, unitMove(mover) + 1)) return undefined;
    const arrival = this.arrival(to);
    const { moved, there, occupied } = arrival;
    if (d > 1 && (arrival.pinned ??= inMelee(moved, there, board))) return undefined;
    let key: string;
    if (d === 1 || mover.traits.ranged >= d) {
      key = `${t}@${vecKey(to)}`;
    } else {
      const from = chargeHex(moved, board, occupied, there, target);
      if (!from) return undefined;
      key = `${t}<${vecKey(from)}`;
    }
    if (!this.own.has(key)) this.own.set(key, blowOn(moved, board, occupied, there, target));
    return this.own.get(key);
  }

  /** Whether `blow` is a charge struck from a hex beside `to`. */
  private struckBeside(blow: Blow | undefined, to: Vec): boolean {
    return !!blow?.from && this.board.distance(blow.from, to) <= 1;
  }

  private liveOn(t: number): number[] {
    if (!this.live) {
      const { me } = this;
      this.live = this.units.map(() => []);
      for (const [attackers, targets] of [
        [this.ours, this.theirs],
        [this.theirs, this.ours],
      ] as const) {
        for (const t of targets) {
          for (const a of attackers) if (a !== me && t !== me && (this.baseBlow(a, t) || this.leaving(a, t))) this.live[t]!.push(a);
        }
      }
    }
    return this.live[t]!;
  }

  /** What unit `t` is threatened with as things stand, by its {@link liveOn live} attackers and, if `mine`, the mover. */
  private baseValue(t: number, mine: boolean): number {
    let value = this.values[t];
    if (value === undefined) {
      const blows = this.liveOn(t).map((a) => this.baseBlow(a, t));
      if (mine) blows.push(this.baseBlow(this.me, t));
      value = targetValue(this.state, this.units[t]!, blows);
      this.values[t] = value;
    }
    return value;
  }

  /**
   * The change to what the enemy (`mine`: the mover's own side) threatens
   * `targets` with when the mover goes to `to`, leaving out what is threatened
   * against the mover itself.
   */
  private shift(to: Vec, mine: boolean, targets: number[]): number {
    const { board, me, fromThere, scratch } = this;
    let total = 0;
    for (const t of targets) {
      if (t === me) continue;
      let changed = false;
      scratch.length = 0;
      for (const a of this.liveOn(t)) {
        const was = this.baseBlow(a, t);
        let now = was;
        if (this.touches(a, t, to, fromThere[a]!, fromThere[t]!)) {
          const { moved, occupied } = this.arrival(to);
          now = blowOn(moved, board, occupied, this.units[a]!, this.units[t]!);
        } else if (this.leaving(a, t)) {
          // With the mover gone an enemy may charge from another hex than it would
          // have, and the mover may now stand beside that one: then the blow is this
          // destination's alone, and not the one to keep for the others.
          const k = this.pair(a, t);
          if (this.goneKnown[k] && (mine || !this.struckBeside(this.gone[k], to))) {
            now = this.gone[k];
          } else {
            const { moved, occupied } = this.arrival(to);
            now = blowOn(moved, board, occupied, this.units[a]!, this.units[t]!);
            if (!this.goneKnown[k] && (mine || !this.struckBeside(now, to))) {
              this.goneKnown[k] = true;
              this.gone[k] = now;
            }
          }
        }
        if (!changed && !sameBlow(now, was)) changed = true;
        scratch.push(now);
      }
      if (mine) {
        const now = this.ownBlow(to, t);
        if (!changed && !sameBlow(now, this.baseBlow(me, t))) changed = true;
        scratch.push(now);
      }
      if (changed) total += targetValue(this.state, this.units[t]!, scratch) - this.baseValue(t, mine);
    }
    return total;
  }

  /**
   * The move's change to threat and to exposure, all but the {@link risk} to
   * the mover where it ends up: the exposure counts what the mover is spared
   * by leaving its hex, and not yet what it meets at `to`.
   */
  partial(to: Vec): { threat: number; exposure: number } {
    this.units.forEach((u, i) => (this.fromThere[i] = this.board.distance(u.pos, to)));
    return {
      threat: this.shift(to, true, this.theirs),
      exposure: this.shift(to, false, this.ours) - this.riskHere(),
    };
  }

  /** What the enemy can expect to do to the mover where it stands now. */
  private riskHere(): number {
    return (this.here ??= targetValue(this.state, this.mover, this.theirs.map((a) => this.baseBlow(a, this.me))));
  }

  /** What the enemy can expect to do to the mover standing on `to`. Never negative. */
  risk(to: Vec): number {
    const { moved, there, occupied } = this.arrival(to);
    return targetValue(moved, there, this.theirs.map((a) => blowOn(moved, this.board, occupied, this.units[a]!, there)));
  }

  /** The move's whole change to threat and to exposure, for the mover's side. */
  delta(to: Vec): { threat: number; exposure: number } {
    const part = this.partial(to);
    return { threat: part.threat, exposure: part.exposure + this.risk(to) };
  }
}
