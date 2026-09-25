import { makeHexGrid, vecKey, type Board, type Vec } from './board.js';
import {
  AIMED_SHOT_PENALTY,
  bigMeleeBonus,
  bigTargetBonus,
  canStrikeBack,
  computeCombatResult,
  flyingMeleeBonus,
  flyingTargetBonus,
  highGroundBonus,
  COVER_PENALTY,
  isGruesome,
  POWER_BLOW_PENALTY,
  PRESSED_COST,
  rangePenalty,
} from './combat.js';
import {
  carryFlags,
  checkRoundLimit,
  dropFallenCarriers,
  fallenKingOwner,
  finishGame,
  flagsAfterMove,
  scoreZones,
} from './mode.js';
import { resolveCombatMorale, type FreeHacks } from './morale.js';
import { rollD6, rollDice } from './rng.js';
import {
  adjacentEnemies,
  inMelee,
  isOccupied,
  livingCount,
  occupiedKeys,
  outnumberedPenalty,
  playerHasAvailable,
  unitAvailable,
  unitById,
  walkRules,
} from './query.js';
import type {
  AttackCommand,
  CombatResult,
  Command,
  GameEvent,
  GameState,
  Owner,
  ReduceResult,
  ShootCommand,
  Unit,
} from './types.js';

/** Turnover happens at 2 or more failed activation dice. */
export const TURNOVER_FAILURES = 2;

/**
 * The whole game: `reduce(state, command) -> { state, events }`, a pure
 * function. `state` is never mutated; a deep clone is advanced and returned.
 */
export function reduce(state: GameState, command: Command): ReduceResult {
  const s: GameState = structuredClone(state);
  const events: GameEvent[] = [];

  switch (command.type) {
    case 'ChooseActivation':
      handleChoose(s, events, command.unitId, command.diceCount);
      break;
    case 'Move':
      handleMove(s, events, command.unitId, command.to);
      break;
    case 'Attack':
      handleAttack(s, events, command);
      break;
    case 'Shoot':
      handleShoot(s, events, command);
      break;
    case 'Guard':
      handleGuard(s, events, command.unitId);
      break;
    case 'EndActivation':
      handleEndActivation(s, events);
      break;
  }

  return { state: s, events };
}

const other = (p: Owner): Owner => (p === 0 ? 1 : 0);

function requirePhase(s: GameState, phase: GameState['phase']): void {
  if (s.phase !== phase) {
    throw new Error(`illegal command: expected phase '${phase}' but state is '${s.phase}'`);
  }
}

function activeUnit(s: GameState): Unit {
  const u = s.activeUnitId ? unitById(s, s.activeUnitId) : undefined;
  if (!u) throw new Error('no unit is currently activating');
  return u;
}

// --- Activation -----------------------------------------------------------

function handleChoose(s: GameState, events: GameEvent[], unitId: string, diceCount: number): void {
  requirePhase(s, 'awaitingActivation');
  const unit = unitById(s, unitId);
  if (!unit) throw new Error(`unknown unit '${unitId}'`);
  if (unit.owner !== s.active) throw new Error(`unit '${unitId}' is not the active player's`);
  if (!unitAvailable(unit)) throw new Error(`unit '${unitId}' is not available to activate`);
  if (s.benched[s.active]) throw new Error(`player ${s.active} is benched this round`);
  if (diceCount < 1 || diceCount > 3) throw new Error(`diceCount must be 1..3, got ${diceCount}`);

  unit.activatedThisRound = true;
  // Activating drops any Guard stance held from a previous round.
  unit.guarding = false;
  events.push({ type: 'ActivationChosen', player: s.active, unitId, diceCount });

  const { dice, state: rngState } = rollDice(s.rngState, diceCount);
  s.rngState = rngState;
  let successes = 0;
  for (const d of dice) if (d >= unit.quality) successes++;
  const failures = diceCount - successes;
  events.push({ type: 'DiceRolled', unitId, quality: unit.quality, dice, successes, failures });

  // The twist: 2+ failures = turnover. The player is benched for the rest of the
  // round, but the unit still takes the actions its successes earned first (3
  // dice with 1 success). (With 1 die you can never reach 2 failures, so a
  // single die can never turn over.)
  if (failures >= TURNOVER_FAILURES) {
    s.benched[s.active] = true;
    events.push({ type: 'Turnover', player: s.active, unitId });
    if (successes === 0) {
      s.activeUnitId = null;
      s.actionsRemaining = 0;
      advanceTurn(s, events);
      return;
    }
  }

  // Successes become action points.
  let actions = successes;
  if (unit.knockedDown && actions > 0) {
    // Standing up costs one action.
    unit.knockedDown = false;
    actions -= 1;
    events.push({ type: 'UnitStoodUp', unitId });
  }

  s.activationCount += 1;
  s.activeUnitId = unitId;
  s.actionsRemaining = actions;

  if (actions <= 0) {
    endActivation(s, events);
    return;
  }
  s.phase = 'acting';
}

// --- Move -----------------------------------------------------------------

function handleMove(s: GameState, events: GameEvent[], unitId: string, to: { x: number; y: number }): void {
  requirePhase(s, 'acting');
  const unit = activeUnit(s);
  if (unit.id !== unitId) throw new Error(`unit '${unitId}' is not the activating unit`);
  if (s.actionsRemaining <= 0) throw new Error('no actions remaining');

  const board = makeHexGrid(s.board);
  if (!board.inBounds(to)) throw new Error('destination out of bounds');
  if (board.isBlocked(to)) throw new Error('destination blocked');
  if (board.distance(unit.pos, to) > unit.move) throw new Error('destination beyond move range');
  // Walks stop on entering contact with an enemy and never pass through one.
  const rules = walkRules(s, unit, board);
  if (!board.reachableWithin(unit.pos, unit.move, rules).has(vecKey(to))) {
    throw new Error('destination unreachable within move range');
  }
  if (isOccupied(s, to, unit.id)) throw new Error('destination occupied');
  const path = board.pathWithin(unit.pos, to, unit.move, rules)!;

  s.actionsRemaining -= 1;
  // Leaving contact: each standing enemy in contact takes a free hack first. A
  // leaver that is cut down or knocked down goes nowhere, and its activation ends.
  if (!resolveFreeHacks(s, events, unit, board)) {
    if (checkGameOver(s, events)) return;
    endActivation(s, events);
    return;
  }

  const from = { ...unit.pos };
  unit.pos = { x: to.x, y: to.y };
  events.push({ type: 'UnitMoved', unitId, from, to: { x: to.x, y: to.y }, path });
  if (flagsAfterMove(s, events, unitId)) return;

  if (s.actionsRemaining <= 0) endActivation(s, events);
}

// --- Attack ---------------------------------------------------------------

function handleAttack(s: GameState, events: GameEvent[], command: AttackCommand): void {
  const { attackerId, targetId } = command;
  requirePhase(s, 'acting');
  const attacker = activeUnit(s);
  if (attacker.id !== attackerId) throw new Error(`unit '${attackerId}' is not the activating unit`);
  // A power blow buys the defender's penalty with a second action.
  const cost = command.power ? PRESSED_COST : 1;
  const powerPenalty = command.power ? POWER_BLOW_PENALTY : 0;
  if (s.actionsRemaining < cost) throw new Error('not enough actions remaining');

  const target = unitById(s, targetId);
  if (!target) throw new Error(`unknown target '${targetId}'`);
  if (target.dead) throw new Error('target already dead');
  if (target.owner === attacker.owner) throw new Error('cannot attack a friendly unit');

  const board = makeHexGrid(s.board);
  if (board.distance(attacker.pos, target.pos) !== 1) throw new Error('target not adjacent');

  // Guard reaction: a guarding defender strikes first. If the riposte kills or
  // knocks the attacker down, the incoming attack is prevented entirely.
  if (target.guarding && target.traits.guard) {
    // The guard strikes before the blow lands, so a power blow's penalty never
    // reaches the riposte — only the swing it was bought for.
    const prevented = resolveRiposte(s, events, target, attacker, board);
    if (prevented) {
      s.actionsRemaining -= cost; // the actions are spent even though the attack was repelled
      if (checkGameOver(s, events)) return;
      endActivation(s, events);
      return;
    }
  }

  const roll = rollMelee(s, board, attacker, target, powerPenalty);
  const { attackDie, defenseDie, attackScore, defenseScore } = roll;
  const attackerPush = pushOutcome(s, board, attacker, target);
  const targetPush = pushOutcome(s, board, target, attacker);
  const result = computeCombatResult(
    { score: attackScore, die: attackDie, knockedDown: attacker.knockedDown, canRecoil: canBePushed(attackerPush) },
    { score: defenseScore, die: defenseDie, knockedDown: target.knockedDown, canRecoil: canBePushed(targetPush) },
  );
  const gruesome = gruesomeKill(result, attackScore, defenseScore);

  events.push({
    type: 'AttackResolved',
    attackerId,
    targetId,
    attackDie,
    defenseDie,
    attackScore,
    defenseScore,
    ...shown({ ...roll.mods, powerPenalty }),
    result,
    ...(gruesome ? { gruesome } : {}),
  });

  let attackerEnded = false;
  switch (result) {
    case 'defenderKilled':
    case 'defenderKnockedDown':
    case 'defenderRecoiled':
      hitDefender(s, events, result, target, attacker.id, board, gruesome, targetPush);
      break;
    case 'attackerKilled':
      strike(s, attacker, target.id, events, board, gruesome);
      attackerEnded = true;
      break;
    case 'attackerKnockedDown':
      knockDown(events, attacker);
      attackerEnded = true; // a knocked-down attacker's activation ends
      break;
    case 'attackerRecoiled':
      push(s, events, attacker, attackerPush, target.id, board);
      // Pushed back or braced it is still standing, so it may act again; pushed
      // off the map it is dead (or, Tough, knocked down at the edge).
      attackerEnded = attacker.dead || attacker.knockedDown;
      break;
    case 'clash':
      break;
  }

  s.actionsRemaining -= cost;

  if (checkGameOver(s, events)) return;
  if (attackerEnded || s.actionsRemaining <= 0) endActivation(s, events);
}

// --- Shoot ----------------------------------------------------------------

function handleShoot(s: GameState, events: GameEvent[], command: ShootCommand): void {
  const { attackerId, targetId } = command;
  requirePhase(s, 'acting');
  const attacker = activeUnit(s);
  if (attacker.id !== attackerId) throw new Error(`unit '${attackerId}' is not the activating unit`);
  // An aimed shot spends a second action to steady the aim.
  const cost = command.aimed ? PRESSED_COST : 1;
  const aimPenalty = command.aimed ? AIMED_SHOT_PENALTY : 0;
  if (s.actionsRemaining < cost) throw new Error('not enough actions remaining');
  if (attacker.traits.ranged < 1) throw new Error('unit has no ranged attack');
  const board = makeHexGrid(s.board);
  if (inMelee(s, attacker, board)) throw new Error('cannot shoot while in melee');

  const target = unitById(s, targetId);
  if (!target) throw new Error(`unknown target '${targetId}'`);
  if (target.dead) throw new Error('target already dead');
  if (target.owner === attacker.owner) throw new Error('cannot shoot a friendly unit');

  const d = board.distance(attacker.pos, target.pos);
  if (d < 2) throw new Error('target too close to shoot');
  if (d > attacker.traits.ranged) throw new Error('target beyond ranged range');
  const occ = occupiedKeys(s);
  if (!board.lineOfSight(attacker.pos, target.pos, (v) => occ.has(vecKey(v))))
    throw new Error('no line of sight to target');

  const { attackDie, defenseDie } = rollPair(s);
  const attackBonus = highGroundBonus(board, attacker, target);
  const defenseBonus = highGroundBonus(board, target, attacker);
  const range = rangePenalty(attacker.traits.ranged, d);
  const cover = board.inCover(attacker.pos, target.pos, (v) => occ.has(vecKey(v))) ? COVER_PENALTY : 0;
  // A Big target is hard to miss, whoever is shooting at it.
  const bigTarget = bigTargetBonus(target);
  // An airborne flyer has no cover in the open sky — easy to shoot down.
  const flyingTarget = flyingTargetBonus(target);
  const attackScore = attacker.combat + attackDie + attackBonus + bigTarget + flyingTarget - range - cover;
  const defenseScore = target.combat + defenseDie + defenseBonus - aimPenalty;

  const targetPush = pushOutcome(s, board, target, attacker);
  // A shot only ever harms the target — the shooter takes no return damage.
  const result = defenderOnly(
    computeCombatResult(
      { score: attackScore, die: attackDie, knockedDown: attacker.knockedDown, canRecoil: false },
      { score: defenseScore, die: defenseDie, knockedDown: target.knockedDown, canRecoil: canBePushed(targetPush) },
    ),
  );
  const gruesome = gruesomeKill(result, attackScore, defenseScore);

  events.push({
    type: 'ShotResolved',
    attackerId,
    targetId,
    attackDie,
    defenseDie,
    attackScore,
    defenseScore,
    ...shown({ attackBonus, defenseBonus, rangePenalty: range, coverPenalty: cover, bigTarget, flyingTarget, aimPenalty }),
    result,
    ...(gruesome ? { gruesome } : {}),
  });

  hitDefender(s, events, result, target, attacker.id, board, gruesome, targetPush);

  s.actionsRemaining -= cost;
  if (checkGameOver(s, events)) return;
  if (s.actionsRemaining <= 0) endActivation(s, events);
}

// --- Guard ----------------------------------------------------------------

function handleGuard(s: GameState, events: GameEvent[], unitId: string): void {
  requirePhase(s, 'acting');
  const unit = activeUnit(s);
  if (unit.id !== unitId) throw new Error(`unit '${unitId}' is not the activating unit`);
  if (!unit.traits.guard) throw new Error('unit cannot Guard');

  unit.guarding = true;
  events.push({ type: 'GuardDeclared', unitId });
  endActivation(s, events);
}

/**
 * A guarding unit's pre-emptive strike against an incoming melee attacker. The
 * guard is treated as the aggressor; only defender-side (attacker-harming)
 * outcomes matter — the guard never wounds itself parrying. Returns whether the
 * attack is prevented (the attacker killed, knocked down or pushed back).
 */
function resolveRiposte(s: GameState, events: GameEvent[], guard: Unit, attacker: Unit, board: Board): boolean {
  const roll = rollMelee(s, board, guard, attacker);
  const { attackDie: guardDie, defenseDie: attackerDie, attackScore: guardScore, defenseScore: attackerScore } = roll;
  const {
    attackBonus: guardBonus,
    defenseBonus: attackerBonus,
    attackOutnumbered: guardOutnumbered,
    defenseOutnumbered: attackerOutnumbered,
    attackBig: guardBig,
    defenseBig: attackerBig,
    attackFly: guardFly,
  } = roll.mods;
  const attackerPush = pushOutcome(s, board, attacker, guard);
  // A knocked-down guard's riposte only lands on a natural 6. And a guard never
  // wounds itself parrying, so only attacker-harming outcomes stand: losing the
  // exchange merely lets the blow in, and is reported — like a shot that draws
  // no return fire — as a clash.
  const result = defenderOnly(
    canStrikeBack(guard.knockedDown, guardDie)
      ? computeCombatResult(
          { score: guardScore, die: guardDie, knockedDown: guard.knockedDown, canRecoil: false },
          {
            score: attackerScore,
            die: attackerDie,
            knockedDown: attacker.knockedDown,
            canRecoil: canBePushed(attackerPush),
          },
        )
      : 'clash',
  );
  // An attacker braced by a friend is not driven back, so its blow still lands.
  const prevented = result !== 'clash' && !(result === 'defenderRecoiled' && attackerPush.kind === 'supported');
  const gruesome = gruesomeKill(result, guardScore, attackerScore);

  events.push({
    type: 'GuardRiposte',
    guardId: guard.id,
    attackerId: attacker.id,
    guardDie,
    attackerDie,
    guardScore,
    attackerScore,
    ...shown({ guardBonus, attackerBonus, guardOutnumbered, attackerOutnumbered, guardBig, attackerBig, guardFly }),
    result,
    ...(gruesome ? { gruesome } : {}),
    prevented,
  });

  hitDefender(s, events, result, attacker, guard.id, board, gruesome, attackerPush);
  return prevented;
}

// --- Free hacks -------------------------------------------------------------

/**
 * A unit leaving contact takes a free hack from every *standing* enemy in
 * contact with it, in unit order. Each is an opposed roll where only the leaver
 * can be hurt: a double kills it (or a Tough save knocks it down), an even-die
 * win knocks it down — either stops the move — and an odd-die win (a "recoil")
 * just lets it slip away. Returns whether the leaver may carry on moving.
 */
function resolveFreeHacks(s: GameState, events: GameEvent[], mover: Unit, board: Board): boolean {
  // A flyer lifts straight up out of contact — no ground blade can catch it.
  if (mover.traits.flying) return true;
  for (const hacker of adjacentEnemies(s, mover, board)) {
    if (hacker.knockedDown) continue;
    const roll = rollMelee(s, board, hacker, mover);
    const { attackDie, defenseDie, attackScore, defenseScore } = roll;
    // Only the leaver can be hurt; the hacker never is.
    const result = defenderOnly(
      computeCombatResult(
        { score: attackScore, die: attackDie, knockedDown: false, canRecoil: false },
        // A leaver always has somewhere to "recoil": the way it was going.
        { score: defenseScore, die: defenseDie, knockedDown: mover.knockedDown, canRecoil: true },
      ),
    );
    const gruesome = gruesomeKill(result, attackScore, defenseScore);

    events.push({
      type: 'FreeHackResolved',
      attackerId: hacker.id,
      targetId: mover.id,
      attackDie,
      defenseDie,
      attackScore,
      defenseScore,
      ...shown(roll.mods),
      result,
      ...(gruesome ? { gruesome } : {}),
    });

    // A kill (or a Tough save onto the ground) and a knockdown both stop the
    // move; a recoil is just the leaver slipping away, so it carries on.
    hitDefender(s, events, result, mover, hacker.id, board, gruesome, null);
    if (result === 'defenderKilled' || result === 'defenderKnockedDown') return false;
  }
  return true;
}

// --- The shared shape of one opposed roll ---------------------------------

/**
 * The situational modifiers already folded into an opposed melee's scores. They
 * ride along so the event can report *why* a score is what it is.
 */
interface MeleeMods {
  attackBonus: number;
  defenseBonus: number;
  attackOutnumbered: number;
  defenseOutnumbered: number;
  attackBig: number;
  defenseBig: number;
  /** The aggressor's flying swoop (a flyer striking a grounded foe). Only ever the aggressor's — flying is pressed, not defended with. */
  attackFly: number;
}

/** One opposed melee: both dice, both scores, and the modifiers behind them. */
interface MeleeRoll {
  attackDie: number;
  defenseDie: number;
  attackScore: number;
  defenseScore: number;
  mods: MeleeMods;
}

/** Roll the aggressor's die then the defender's, advancing `s.rngState`. */
function rollPair(s: GameState): { attackDie: number; defenseDie: number } {
  const atk = rollD6(s.rngState);
  const def = rollD6(atk.state);
  s.rngState = def.state;
  return { attackDie: atk.die, defenseDie: def.die };
}

/**
 * Roll one opposed melee exchange (mutates `s.rngState`). Each side scores its
 * Combat plus its die, any high ground and any edge its size gives it, less what
 * it is outnumbered by; `defensePenalty` (a power blow's) comes off the defender
 * on top. Every melee
 * in the game — an ordinary blow, a guard's riposte, a free hack — is scored
 * exactly this way, so none of them can drift from the others.
 */
function rollMelee(
  s: GameState,
  board: Board,
  aggressor: Unit,
  defender: Unit,
  defensePenalty = 0,
): MeleeRoll {
  const { attackDie, defenseDie } = rollPair(s);
  const mods: MeleeMods = {
    attackBonus: highGroundBonus(board, aggressor, defender),
    defenseBonus: highGroundBonus(board, defender, aggressor),
    attackOutnumbered: outnumberedPenalty(s, aggressor, board),
    defenseOutnumbered: outnumberedPenalty(s, defender, board),
    attackBig: bigMeleeBonus(aggressor, defender),
    defenseBig: bigMeleeBonus(defender, aggressor),
    attackFly: flyingMeleeBonus(aggressor, defender),
  };
  return {
    attackDie,
    defenseDie,
    attackScore:
      aggressor.combat + attackDie + mods.attackBonus + mods.attackBig + mods.attackFly - mods.attackOutnumbered,
    defenseScore:
      defender.combat + defenseDie + mods.defenseBonus + mods.defenseBig - mods.defenseOutnumbered - defensePenalty,
    mods,
  };
}

/**
 * An outcome for a combat where only the defender can be hurt (a shot, a
 * riposte, a free hack): anything that would harm the aggressor is reported as
 * the clash it effectively is, so no event ever names damage the rules never
 * dealt.
 */
function defenderOnly(result: CombatResult): CombatResult {
  return result.startsWith('defender') ? result : 'clash';
}

/** Drop the zero modifiers, so an event only ever carries the ones that applied. */
function shown<K extends string>(mods: Record<K, number | undefined>): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const key of Object.keys(mods) as K[]) {
    const value = mods[key];
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Apply a defender-side outcome to `victim` (mutates `s`): a killing blow
 * (honouring Tough and the morale that follows), a knockdown, or the push
 * `pushed` (null: the push does nothing, as for a leaver slipping away). Any
 * other `result` — including a clash — does nothing.
 */
function hitDefender(
  s: GameState,
  events: GameEvent[],
  result: CombatResult,
  victim: Unit,
  byId: string,
  board: Board,
  gruesome: boolean,
  pushed: Push | null,
): void {
  if (result === 'defenderKilled') strike(s, victim, byId, events, board, gruesome);
  else if (result === 'defenderKnockedDown') knockDown(events, victim);
  else if (result === 'defenderRecoiled' && pushed) push(s, events, victim, pushed, byId, board);
}

function knockDown(events: GameEvent[], unit: Unit): void {
  unit.knockedDown = true;
  unit.guarding = false; // flat on the ground is no stance to hold
  events.push({ type: 'UnitKnockedDown', unitId: unit.id });
}

/** Whether `result` is a kill that tripled the loser, given the aggressor's and the defender's scores. */
function gruesomeKill(result: CombatResult, aggressorScore: number, defenderScore: number): boolean {
  if (result === 'defenderKilled') return isGruesome(aggressorScore, defenderScore);
  if (result === 'attackerKilled') return isGruesome(defenderScore, aggressorScore);
  return false;
}

/**
 * What pushing `unit` one hex directly away from `by` would do:
 * - `back`: the hex is free, so it recoils into it;
 * - `supported`: a standing friend holds that hex and braces it — it stays put, on its feet;
 * - `off`: the hex is off the map, so the push kills it;
 * - `blocked`: impassable terrain, an enemy or a knocked-down friend — it falls instead.
 */
type Push = { kind: 'back'; to: Vec } | { kind: 'supported'; by: Unit } | { kind: 'off' } | { kind: 'blocked' };

function pushOutcome(s: GameState, board: Board, unit: Unit, by: Unit): Push {
  const to = board.stepAway(by.pos, unit.pos);
  if (!board.inBounds(to)) return { kind: 'off' };
  if (board.isBlocked(to)) return { kind: 'blocked' };
  const there = s.units.find((u) => !u.dead && u.id !== unit.id && u.pos.x === to.x && u.pos.y === to.y);
  if (!there) return { kind: 'back', to };
  return there.owner === unit.owner && !there.knockedDown ? { kind: 'supported', by: there } : { kind: 'blocked' };
}

/** Whether a push has somewhere to resolve other than a fall (see {@link pushOutcome}). */
const canBePushed = (p: Push) => p.kind !== 'blocked';

/**
 * Resolve a winning odd-die push on `unit` (mutates `s`): recoil into the free
 * hex, stand braced against a supporting friend, or go off the map — a combat
 * kill by `byId` (a Tough unit is knocked down at the edge instead).
 */
function push(s: GameState, events: GameEvent[], unit: Unit, p: Push, byId: string, board: Board): void {
  if (p.kind === 'back') recoil(s, events, unit, p.to);
  else if (p.kind === 'supported') events.push({ type: 'UnitSupported', unitId: unit.id, supporterId: p.by.id });
  else if (p.kind === 'off') {
    events.push({ type: 'UnitPushedOff', unitId: unit.id });
    strike(s, unit, byId, events, board, false);
  }
}

function recoil(s: GameState, events: GameEvent[], unit: Unit, to: Vec): void {
  const from = { ...unit.pos };
  unit.pos = { x: to.x, y: to.y };
  unit.guarding = false; // shoved out of position, stance broken
  carryFlags(s, unit);
  events.push({ type: 'UnitRecoiled', unitId: unit.id, from, to: { x: to.x, y: to.y } });
}

/**
 * A killing blow from combat: apply it (honouring Tough), and if the unit
 * actually dies, resolve the morale fallout — after a `gruesome` kill nearby
 * friends test nerve, and the warband may rout; those that break and run take
 * free hacks like any leaver. Tough saves that downgrade the blow to a
 * knockdown are not a death, so they raise no morale check.
 */
function strike(s: GameState, unit: Unit, byId: string | null, events: GameEvent[], board: Board, gruesome: boolean): void {
  if (!resolveKill(unit, byId, events)) return;
  const hacks: FreeHacks = (runner) => resolveFreeHacks(s, events, runner, board);
  resolveCombatMorale(s, events, unit, board, gruesome, hacks);
}

/**
 * Apply a killing blow, honouring Tough: a tough unit that is not already
 * knocked down is knocked down instead (its one free save). Returns whether the
 * unit actually died. Morale-free — callers that represent a *combat* death use
 * {@link strike}.
 */
function resolveKill(unit: Unit, byId: string | null, events: GameEvent[]): boolean {
  if (unit.traits.tough && !unit.knockedDown) {
    events.push({ type: 'ToughnessSaved', unitId: unit.id });
    knockDown(events, unit);
    return false;
  }
  unit.dead = true;
  unit.knockedDown = false;
  events.push({ type: 'UnitKilled', unitId: unit.id, byId });
  return true;
}

// --- Activation / round control ------------------------------------------

function handleEndActivation(s: GameState, events: GameEvent[]): void {
  requirePhase(s, 'acting');
  endActivation(s, events);
}

function endActivation(s: GameState, events: GameEvent[]): void {
  const endedId = s.activeUnitId;
  if (endedId) events.push({ type: 'ActivationEnded', unitId: endedId });
  s.activeUnitId = null;
  s.actionsRemaining = 0;
  advanceTurn(s, events);
}

/**
 * Decide who acts next after an activation ends (normally or via turnover).
 * Preference: hand off to the opponent; else the current player continues solo;
 * else the round ends.
 */
function advanceTurn(s: GameState, events: GameEvent[]): void {
  if (checkGameOver(s, events)) return;

  const current = s.active;
  const opp = other(current);

  if (playerHasAvailable(s, opp)) {
    s.active = opp;
    s.phase = 'awaitingActivation';
    return;
  }
  if (playerHasAvailable(s, current)) {
    // Solo continuation: opponent benched or exhausted.
    s.phase = 'awaitingActivation';
    return;
  }
  endRound(s, events);
}

function endRound(s: GameState, events: GameEvent[]): void {
  if (scoreZones(s, events) || checkRoundLimit(s, events)) return;
  // Whoever activated last this round goes second next round.
  const lastActivated = s.active;
  s.round += 1;
  for (const u of s.units) u.activatedThisRound = false;
  s.benched = [false, false];
  s.initiativeLeader = other(lastActivated);
  s.active = s.initiativeLeader;
  s.phase = 'awaitingActivation';
  events.push({ type: 'RoundEnded', round: s.round, nextLeader: s.initiativeLeader });
  // Reassembling bones haul themselves up before anyone acts: a free stand-up at
  // the top of the round, no action and no die spent.
  for (const u of s.units) {
    if (u.dead || !u.knockedDown || !u.traits.reassembling) continue;
    u.knockedDown = false;
    events.push({ type: 'UnitStoodUp', unitId: u.id, reassembled: true });
  }
}

function checkGameOver(s: GameState, events: GameEvent[]): boolean {
  if (s.phase === 'gameOver') return true;
  // Capture-the-flag: knocked-down and fallen carriers drop what they carry.
  dropFallenCarriers(s, events);
  // Kill-the-king: a fallen King loses at once, even with the warband intact.
  const kingless = fallenKingOwner(s);
  if (kingless !== undefined) {
    finishGame(s, events, other(kingless), 'king');
    return true;
  }
  const p0 = livingCount(s, 0);
  const p1 = livingCount(s, 1);
  if (p0 > 0 && p1 > 0) return false;
  finishGame(s, events, p0 > 0 ? 0 : 1, 'annihilation');
  return true;
}
