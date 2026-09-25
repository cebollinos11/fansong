import {
  isImpassableFeature,
  isOccupied,
  MAX_ELEVATION,
  normalizeTerrain,
  reduce,
  rollDice,
  vecKey,
  type CombatResult,
  type Command,
  type GameEvent,
  type GameState,
  type HexTerrain,
  type Owner,
  type ReduceResult,
  type TerrainFeature,
  type Unit,
  type UnitTraits,
  type Vec,
} from '@fansong/engine';
import type { WarbandUnit } from '@fansong/content';

/**
 * The dev sandbox's rule-bending operations. Everything here is pure: each edit
 * takes a state and returns a new one, never touching the engine's rules. The
 * engine never sees these as commands — they are "god mode" rewrites of the
 * state a match is played from, so a situation can be set up in seconds and
 * then played out with the real reducer.
 *
 * Dice are forced without an engine hook: every roll is drawn from
 * `state.rngState`, a plain 32-bit number, so the sandbox searches for an RNG
 * state whose next rolls are the ones wanted and swaps it in.
 */

// --- Placement and units ----------------------------------------------------

/** Why a unit can't stand on `pos` (ignoring `ignoreId`), or null if it can. */
export function placementProblem(state: GameState, pos: Vec, ignoreId?: string): string | null {
  const { width, height } = state.board;
  if (pos.x < 0 || pos.y < 0 || pos.x >= width || pos.y >= height) return 'off the board';
  if (state.board.blocked.includes(vecKey(pos))) return 'that hex is blocked';
  if (isImpassableFeature(state.board.terrain?.[vecKey(pos)]?.feature)) return 'that hex is impassable';
  if (isOccupied(state, pos, ignoreId)) return 'that hex is occupied';
  return null;
}

/** The next unused `p<owner>u<n>` id, so a spawned unit never collides with an old one. */
export function nextUnitId(state: GameState, owner: Owner): string {
  const prefix = `p${owner}u`;
  let max = -1;
  for (const u of state.units) {
    if (!u.id.startsWith(prefix)) continue;
    const n = Number(u.id.slice(prefix.length));
    if (Number.isInteger(n)) max = Math.max(max, n);
  }
  return `${prefix}${max + 1}`;
}

/**
 * Put a fresh unit from `profile` on `pos`. It counts toward its side's starting
 * strength (the rout threshold), as if it had been deployed. Throws if the hex
 * can't take it.
 */
export function spawnUnit(state: GameState, owner: Owner, profile: WarbandUnit, pos: Vec): GameState {
  const problem = placementProblem(state, pos);
  if (problem) throw new Error(`Can't spawn there: ${problem}.`);
  const s = structuredClone(state);
  const unit: Unit = {
    id: nextUnitId(s, owner),
    owner,
    name: profile.name,
    quality: profile.quality,
    combat: profile.combat,
    move: profile.move,
    pos: { x: pos.x, y: pos.y },
    dead: false,
    knockedDown: false,
    activatedThisRound: false,
    traits: {
      ranged: profile.ranged ?? 0,
      tough: profile.tough ?? false,
      guard: profile.guard ?? false,
      big: profile.big ?? false,
      flying: profile.flying ?? false,
      reassembling: profile.reassembling ?? false,
    },
    guarding: false,
  };
  if (profile.look !== undefined) unit.look = profile.look;
  s.units.push(unit);
  s.startCount[owner] += 1;
  return s;
}

/**
 * Take a unit off the board as if it had never been deployed (its side's
 * starting strength shrinks too). To test a *casualty*, mark it dead instead.
 */
export function removeUnit(state: GameState, id: string): GameState {
  const s = structuredClone(state);
  const unit = s.units.find((u) => u.id === id);
  if (!unit) return state;
  s.units = s.units.filter((u) => u.id !== id);
  s.startCount[unit.owner] = Math.max(0, s.startCount[unit.owner] - 1);
  if (s.activeUnitId === id) dropActivation(s);
  return s;
}

/** Remove every unit (of one side, or both). */
export function clearUnits(state: GameState, owner?: Owner): GameState {
  let s = state;
  for (const u of state.units) if (owner === undefined || u.owner === owner) s = removeUnit(s, u.id);
  return s;
}

/** Teleport a unit to `pos` — no move action, no free hacks, no flag pickup. */
export function teleportUnit(state: GameState, id: string, pos: Vec): GameState {
  const problem = placementProblem(state, pos, id);
  if (problem) throw new Error(`Can't move there: ${problem}.`);
  const s = structuredClone(state);
  const unit = s.units.find((u) => u.id === id);
  if (!unit) throw new Error(`No unit '${id}'.`);
  unit.pos = { x: pos.x, y: pos.y };
  return s;
}

/** The unit fields the inspector may rewrite. */
export type UnitPatch = Partial<
  Pick<Unit, 'name' | 'owner' | 'quality' | 'combat' | 'move' | 'dead' | 'knockedDown' | 'activatedThisRound' | 'guarding'>
> & { traits?: Partial<UnitTraits> };

/** Rewrite a unit's stats, traits or status flags. */
export function patchUnit(state: GameState, id: string, patch: UnitPatch): GameState {
  const s = structuredClone(state);
  const unit = s.units.find((u) => u.id === id);
  if (!unit) throw new Error(`No unit '${id}'.`);
  const { traits, ...rest } = patch;
  Object.assign(unit, rest);
  if (traits) Object.assign(unit.traits, traits);
  // A dead unit neither stands guard nor lies knocked down.
  if (unit.dead) {
    unit.knockedDown = false;
    unit.guarding = false;
    if (s.activeUnitId === id) dropActivation(s);
  }
  return s;
}

// --- Turn flow --------------------------------------------------------------

function dropActivation(s: GameState): void {
  s.activeUnitId = null;
  s.actionsRemaining = 0;
  if (s.phase === 'acting') s.phase = 'awaitingActivation';
}

/**
 * Skip the activation roll: `id` is mid-activation with `actions` actions, as if
 * its dice had come up that way. Its side becomes the one to act.
 */
export function activateUnit(state: GameState, id: string, actions: number): GameState {
  const s = structuredClone(state);
  const unit = s.units.find((u) => u.id === id);
  if (!unit) throw new Error(`No unit '${id}'.`);
  if (unit.dead) throw new Error(`${unit.name} is dead.`);
  if (actions < 1) throw new Error('A unit needs at least one action.');
  if (s.activeUnitId && s.activeUnitId !== id) {
    const prev = s.units.find((u) => u.id === s.activeUnitId);
    if (prev) prev.activatedThisRound = true;
  }
  unit.activatedThisRound = true;
  unit.guarding = false;
  s.phase = 'acting';
  s.winner = null;
  s.active = unit.owner;
  s.benched[unit.owner] = false;
  s.activeUnitId = id;
  s.actionsRemaining = actions;
  return s;
}

/** Hand the turn to `owner`, between activations (cancels any activation in progress). */
export function setActivePlayer(state: GameState, owner: Owner): GameState {
  const s = structuredClone(state);
  dropActivation(s);
  if (s.phase === 'gameOver') resume(s);
  s.active = owner;
  s.benched[owner] = false;
  return s;
}

/** Everyone is fresh again: no one has activated, no one is benched. Keeps the round number. */
export function freshRound(state: GameState): GameState {
  const s = structuredClone(state);
  for (const u of s.units) u.activatedThisRound = false;
  s.benched = [false, false];
  dropActivation(s);
  if (s.phase === 'gameOver') resume(s);
  return s;
}

function resume(s: GameState): void {
  s.phase = 'awaitingActivation';
  s.winner = null;
}

/** Undo a game over so play can continue from here. */
export function resumeGame(state: GameState): GameState {
  const s = structuredClone(state);
  if (s.phase === 'gameOver') resume(s);
  return s;
}

/** Set the round counter (for round-limit and scoring tests). */
export function setRound(state: GameState, round: number): GameState {
  const s = structuredClone(state);
  s.round = Math.max(1, Math.floor(round));
  return s;
}

/** Set an objective mode's scores. A no-op in annihilation, which keeps none. */
export function setScores(state: GameState, scores: [number, number]): GameState {
  if (!state.mode) return state;
  const s = structuredClone(state);
  s.mode!.scores = [Math.max(0, scores[0]), Math.max(0, scores[1])];
  return s;
}

/** Toggle whether a side is benched (turned over) for the rest of the round. */
export function setBenched(state: GameState, owner: Owner, benched: boolean): GameState {
  const s = structuredClone(state);
  s.benched[owner] = benched;
  return s;
}

/**
 * What a state that the sandbox has bent may be missing to carry on — a turn
 * the engine can't move forward from on its own. Null when play can continue.
 */
export function stuckReason(state: GameState, legalCount: number): string | null {
  if (state.phase === 'gameOver' || legalCount > 0) return null;
  if (state.phase === 'acting') return 'The acting unit has no legal command.';
  return `Player ${state.active} has no unit that can activate.`;
}

// --- Terrain ----------------------------------------------------------------

/** What a terrain brush writes to a hex. `feature: null` clears the feature. */
export interface HexPaint {
  elevation?: number;
  feature?: TerrainFeature | null;
  blocked?: boolean;
}

/** Repaint one hex. Refuses to bury a unit under an impassable feature or a block. */
export function paintHex(state: GameState, pos: Vec, paint: HexPaint): GameState {
  const { width, height } = state.board;
  if (pos.x < 0 || pos.y < 0 || pos.x >= width || pos.y >= height) return state;
  const key = vecKey(pos);
  const occupied = isOccupied(state, pos);
  if (occupied && (paint.blocked || (paint.feature && isImpassableFeature(paint.feature)))) {
    throw new Error('Move the unit off that hex first.');
  }
  const s = structuredClone(state);
  const hex: HexTerrain = { ...(s.board.terrain?.[key] ?? {}) };
  if (paint.elevation !== undefined) hex.elevation = Math.max(0, Math.min(MAX_ELEVATION, paint.elevation));
  if (paint.feature !== undefined) {
    if (paint.feature === null) delete hex.feature;
    else hex.feature = paint.feature;
  }
  const terrain = normalizeTerrain({ ...(s.board.terrain ?? {}), [key]: hex });
  if (terrain) s.board.terrain = terrain;
  else delete s.board.terrain;
  if (paint.blocked !== undefined) {
    const rest = s.board.blocked.filter((k) => k !== key);
    s.board.blocked = paint.blocked ? [...rest, key] : rest;
  }
  return s;
}

// --- Dice -------------------------------------------------------------------

/** The next `n` d6 the state's RNG will roll, in order. */
export function peekDice(state: GameState, n: number): number[] {
  return rollDice(state.rngState, n).dice;
}

/** Every candidate RNG state tried, well spread over 32 bits (a golden-ratio stride). */
function candidate(start: number, i: number): number {
  return (start + Math.imul(i, 0x9e3779b9)) | 0;
}

/**
 * Parse a dice pattern like `"6 1 ? 4"`: faces 1–6 in order, `?` or `*` for a
 * die that may be anything. Throws on anything else.
 */
export function parseDicePattern(text: string): (number | null)[] {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  return tokens.map((t) => {
    if (t === '?' || t === '*') return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1 || n > 6) throw new Error(`"${t}" isn't a die face (1–6, or ? for any).`);
    return n;
  });
}

/** Most fixed dice {@link forceDice} will search for (6^8 ≈ 1.7M tries on average). */
export const MAX_FORCED_DICE = 8;

/**
 * An RNG state whose next rolls match `pattern` (`null` = any face). Searched,
 * not constructed: mulberry32 can't be run backwards, but a match for a few dice
 * turns up fast. Throws past {@link MAX_FORCED_DICE} fixed dice.
 */
export function findRngState(pattern: readonly (number | null)[], start = 0): number {
  const fixed = pattern.filter((d) => d !== null).length;
  if (fixed > MAX_FORCED_DICE) throw new Error(`At most ${MAX_FORCED_DICE} fixed dice can be forced.`);
  const limit = 200 * 6 ** fixed;
  for (let i = 0; i < limit; i++) {
    const s = candidate(start, i);
    const { dice } = rollDice(s, pattern.length);
    if (dice.every((d, j) => pattern[j] === null || pattern[j] === d)) return s;
  }
  throw new Error('No RNG state found for those dice.');
}

/** The state with its RNG set so the next rolls are `pattern`. */
export function forceDice(state: GameState, pattern: readonly (number | null)[]): GameState {
  const s = structuredClone(state);
  s.rngState = findRngState(pattern, state.rngState ^ 0x5bd1e995);
  return s;
}

/** The state with a fresh, arbitrary RNG state (reroll everything to come). */
export function rerollRng(state: GameState, random: () => number = Math.random): GameState {
  const s = structuredClone(state);
  s.rngState = Math.floor(random() * 0x100000000) | 0;
  return s;
}

// --- Forced outcomes --------------------------------------------------------

/**
 * A result the sandbox can force on the next command that produces it. `applies`
 * says whether a command's events are the kind the rule is about (so a rule
 * about combat waits out plain moves); `matches` whether they came out the way
 * wanted.
 */
export interface OutcomeRule {
  id: string;
  group: string;
  label: string;
  applies(events: readonly GameEvent[]): boolean;
  matches(events: readonly GameEvent[]): boolean;
}

type Clash = Extract<GameEvent, { type: 'AttackResolved' | 'ShotResolved' | 'FreeHackResolved' }>;
const isClash = (e: GameEvent): e is Clash =>
  e.type === 'AttackResolved' || e.type === 'ShotResolved' || e.type === 'FreeHackResolved';
const firstClash = (events: readonly GameEvent[]) => events.find(isClash);
const has = (events: readonly GameEvent[], type: GameEvent['type']) => events.some((e) => e.type === type);
const diceRoll = (events: readonly GameEvent[]) =>
  events.find((e): e is Extract<GameEvent, { type: 'DiceRolled' }> => e.type === 'DiceRolled');
const riposte = (events: readonly GameEvent[]) =>
  events.find((e): e is Extract<GameEvent, { type: 'GuardRiposte' }> => e.type === 'GuardRiposte');
const nerves = (events: readonly GameEvent[]) =>
  events.filter((e): e is Extract<GameEvent, { type: 'NerveCheck' }> => e.type === 'NerveCheck');

const COMBAT_LABELS: Record<CombatResult, string> = {
  defenderKilled: 'Defender killed',
  defenderKnockedDown: 'Defender knocked down',
  defenderRecoiled: 'Defender pushed back',
  attackerKilled: 'Attacker killed',
  attackerKnockedDown: 'Attacker knocked down',
  attackerRecoiled: 'Attacker pushed back',
  clash: 'Clash (no effect)',
};

export const OUTCOME_RULES: readonly OutcomeRule[] = [
  {
    id: 'act-all',
    group: 'Activation roll',
    label: 'Every die succeeds',
    applies: (ev) => diceRoll(ev) !== undefined,
    matches: (ev) => diceRoll(ev)?.failures === 0,
  },
  {
    id: 'act-one-fail',
    group: 'Activation roll',
    label: 'Exactly one die fails',
    applies: (ev) => diceRoll(ev) !== undefined,
    matches: (ev) => diceRoll(ev)?.failures === 1,
  },
  {
    id: 'act-turnover',
    group: 'Activation roll',
    label: 'Turnover',
    applies: (ev) => diceRoll(ev) !== undefined,
    matches: (ev) => has(ev, 'Turnover'),
  },
  ...(Object.keys(COMBAT_LABELS) as CombatResult[]).map(
    (result): OutcomeRule => ({
      id: `combat-${result}`,
      group: 'Attack, shot or free hack',
      label: COMBAT_LABELS[result],
      applies: (ev) => firstClash(ev) !== undefined,
      matches: (ev) => {
        const clash = firstClash(ev);
        if (clash?.result !== result) return false;
        // A kill only counts if the unit really dies — not if Tough saves it.
        const victim = result === 'defenderKilled' ? clash.targetId : result === 'attackerKilled' ? clash.attackerId : null;
        return victim === null || ev.some((e) => e.type === 'UnitKilled' && e.unitId === victim);
      },
    }),
  ),
  {
    id: 'combat-gruesome',
    group: 'Attack, shot or free hack',
    label: 'Gruesome kill (fear checks)',
    applies: (ev) => firstClash(ev) !== undefined,
    matches: (ev) => firstClash(ev)?.gruesome === true,
  },
  {
    id: 'riposte-prevents',
    group: 'Guard riposte',
    label: 'Riposte stops the attack',
    applies: (ev) => riposte(ev) !== undefined,
    matches: (ev) => riposte(ev)?.prevented === true,
  },
  {
    id: 'riposte-fails',
    group: 'Guard riposte',
    label: 'Riposte fails',
    applies: (ev) => riposte(ev) !== undefined,
    matches: (ev) => riposte(ev)?.prevented === false,
  },
  {
    id: 'nerve-pass',
    group: 'Nerve checks',
    label: 'Every nerve check passes',
    applies: (ev) => nerves(ev).length > 0,
    matches: (ev) => nerves(ev).every((e) => e.passed),
  },
  {
    id: 'nerve-fail',
    group: 'Nerve checks',
    label: 'Every nerve check fails',
    applies: (ev) => nerves(ev).length > 0,
    matches: (ev) => nerves(ev).every((e) => !e.passed),
  },
];

export function outcomeRule(id: string): OutcomeRule | undefined {
  return OUTCOME_RULES.find((r) => r.id === id);
}

/** How a forced command came out. */
export type ForceStatus =
  /** The command produced nothing the rule is about; it played normally. */
  | { kind: 'notApplicable' }
  /** Forced (or it happened on its own: `tries` 0). */
  | { kind: 'forced'; tries: number }
  /** No RNG state gives that result here (e.g. a kill a +1 can't reach); it played normally. */
  | { kind: 'impossible'; tries: number };

/** How many RNG states to try before calling an outcome impossible. */
export const MAX_OUTCOME_TRIES = 20000;

/**
 * Reduce `command` so that it comes out the way `rule` wants, by trying RNG
 * states until the reducer's own events match. Every modifier, trait and
 * follow-on roll is accounted for, because the real reducer decides each try.
 */
export function forceOutcome(
  state: GameState,
  command: Command,
  rule: OutcomeRule,
  maxTries = MAX_OUTCOME_TRIES,
): { result: ReduceResult; status: ForceStatus } {
  const natural = reduce(state, command);
  if (!rule.applies(natural.events)) return { result: natural, status: { kind: 'notApplicable' } };
  if (rule.matches(natural.events)) return { result: natural, status: { kind: 'forced', tries: 0 } };
  for (let i = 1; i <= maxTries; i++) {
    const tried = reduce({ ...state, rngState: candidate(state.rngState, i) }, command);
    if (rule.applies(tried.events) && rule.matches(tried.events)) {
      return { result: tried, status: { kind: 'forced', tries: i } };
    }
  }
  return { result: natural, status: { kind: 'impossible', tries: maxTries } };
}

// --- Snapshots --------------------------------------------------------------

/** A loose shape check for a state read back from a file or storage. */
export function parseSandboxState(json: unknown): GameState {
  const s = (json && typeof json === 'object' && 'state' in json ? (json as { state: unknown }).state : json) as
    | Partial<GameState>
    | null;
  if (
    !s ||
    typeof s !== 'object' ||
    !Array.isArray(s.units) ||
    !s.board ||
    typeof s.board.width !== 'number' ||
    typeof s.rngState !== 'number' ||
    typeof s.phase !== 'string'
  ) {
    throw new Error("That isn't a FanSong game state.");
  }
  return s as GameState;
}
