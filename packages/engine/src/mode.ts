import type { Vec } from './board.js';
import { livingCount } from './query.js';
import type { GameEvent, GameOverReason, GameState, Owner, Unit } from './types.js';

/**
 * Game modes. The mode decides how a match is won; the map's objectives decide
 * which modes it can host. `annihilation` is the original rule set and the
 * default — a config without a mode plays exactly as before.
 */
export type GameMode =
  | 'annihilation'
  | 'capture-the-flag'
  | 'king-of-the-hill'
  | 'conquest'
  | 'kill-the-king';

/** Every mode, in a fixed display order. */
export const GAME_MODES: ReadonlyArray<GameMode> = [
  'annihilation',
  'kill-the-king',
  'king-of-the-hill',
  'conquest',
  'capture-the-flag',
];

/** A mode other than annihilation — the ones that carry {@link ModeState}. */
export type ObjectiveMode = Exclude<GameMode, 'annihilation'>;

/**
 * Objective placements handed to the engine (the map's objectives, trimmed to
 * what the mode uses). Mirrors the content `MapObjectives` shape.
 */
export interface ModeObjectives {
  /** Capture-the-flag: the flag base hex of player 0 and player 1. */
  flags?: [Vec, Vec];
  /** King-of-the-hill: the hexes of the single scoring zone. */
  hill?: Vec[];
  /** Conquest: three scoring zones, each a set of hexes. */
  conquest?: [Vec[], Vec[], Vec[]];
}

/**
 * Per-match mode state. Present on {@link GameState} only for objective modes,
 * so an annihilation game's state (and every existing replay hash) is unchanged.
 */
export interface ModeState {
  mode: ObjectiveMode;
  objectives: ModeObjectives;
  /** Points scored by player 0 and player 1 (zone modes; flag captures). */
  scores: [number, number];
  /** Kill-the-king: the unit id of player 0's and player 1's King. */
  kings?: [string, string];
  /** Capture-the-flag: where player 0's and player 1's flag is, and who carries it. */
  flags?: [FlagState, FlagState];
}

/**
 * One flag in capture-the-flag. `at` is its hex: the owner's base, the hex it
 * was dropped on, or — while carried — the carrier's hex (kept in step on
 * every move so renderers never need to look the carrier up).
 */
export interface FlagState {
  at: Vec;
  /** Unit id of the enemy unit carrying it, or `null` when it lies on a hex. */
  carrier: string | null;
}

/** Static rules per mode: the score that wins outright and the round cap. */
export interface ModeRules {
  /** Reaching this score ends the game immediately. */
  targetScore?: number;
  /** After this round ends the higher score wins (tie → {@link tiebreakWinner}). */
  roundLimit?: number;
  /** Objectives the mode needs in its config. */
  requires?: keyof ModeObjectives;
}

/** Rounds played in the scoring modes before the game is called on points. */
export const ROUND_LIMIT = 12;

export const MODE_RULES: Readonly<Record<GameMode, ModeRules>> = {
  annihilation: {},
  'kill-the-king': {},
  'king-of-the-hill': { targetScore: 5, roundLimit: ROUND_LIMIT, requires: 'hill' },
  conquest: { targetScore: 8, roundLimit: ROUND_LIMIT, requires: 'conquest' },
  'capture-the-flag': { requires: 'flags' },
};

/** The mode a state is playing (`annihilation` when it carries no mode state). */
export function gameMode(state: GameState): GameMode {
  return state.mode?.mode ?? 'annihilation';
}

const copyVecs = (vs: Vec[]): Vec[] => vs.map((v) => ({ x: v.x, y: v.y }));

/**
 * Build the initial mode state for a config, or `undefined` for annihilation.
 * Only the objectives the mode uses are kept. Throws when the mode's required
 * objectives are missing or empty.
 */
export function createModeState(mode: GameMode | undefined, objectives: ModeObjectives | undefined): ModeState | undefined {
  if (!mode || mode === 'annihilation') return undefined;
  const need = MODE_RULES[mode].requires;
  const obj: ModeObjectives = {};
  if (need === 'flags') {
    const f = objectives?.flags;
    if (!f) throw new Error(`mode '${mode}' needs flag bases`);
    obj.flags = [{ x: f[0].x, y: f[0].y }, { x: f[1].x, y: f[1].y }];
    return {
      mode,
      objectives: obj,
      scores: [0, 0],
      flags: [
        { at: { x: f[0].x, y: f[0].y }, carrier: null },
        { at: { x: f[1].x, y: f[1].y }, carrier: null },
      ],
    };
  } else if (need === 'hill') {
    const h = objectives?.hill;
    if (!h || h.length === 0) throw new Error(`mode '${mode}' needs a hill zone`);
    obj.hill = copyVecs(h);
  } else if (need === 'conquest') {
    const c = objectives?.conquest;
    if (!c || c.length !== 3 || c.some((z) => z.length === 0)) {
      throw new Error(`mode '${mode}' needs three non-empty conquest zones`);
    }
    obj.conquest = [copyVecs(c[0]), copyVecs(c[1]), copyVecs(c[2])];
  }
  return { mode, objectives: obj, scores: [0, 0] };
}

/** Strength still standing on the table: living units, then standing units, then summed combat. */
function tiebreakKey(state: GameState, p: Owner): [number, number, number] {
  let standing = 0;
  let combat = 0;
  for (const u of state.units) {
    if (u.dead || u.owner !== p) continue;
    if (!u.knockedDown) standing++;
    combat += u.combat;
  }
  return [livingCount(state, p), standing, combat];
}

/**
 * Annihilation-style tiebreak for a game called on a tied score: the side with
 * more living units wins; then more standing (not knocked down) units; then the
 * higher summed combat of its living units. A perfect tie goes to player 1, who
 * gave up first initiative in round 1.
 */
export function tiebreakWinner(state: GameState): Owner {
  const a = tiebreakKey(state, 0);
  const b = tiebreakKey(state, 1);
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]! ? 0 : 1;
  }
  return 1;
}

/** The winner once the round cap is reached: higher score, else the tiebreak. */
export function roundLimitWinner(state: GameState): Owner {
  const [s0, s1] = state.mode?.scores ?? [0, 0];
  if (s0 !== s1) return s0 > s1 ? 0 : 1;
  return tiebreakWinner(state);
}

/**
 * End the game (mutates `s`). The `GameOver` event names its reason only in an
 * objective mode, so an annihilation game's events are unchanged.
 */
export function finishGame(s: GameState, events: GameEvent[], winner: Owner, reason: GameOverReason): void {
  s.winner = winner;
  s.phase = 'gameOver';
  s.activeUnitId = null;
  s.actionsRemaining = 0;
  events.push(s.mode ? { type: 'GameOver', winner, reason } : { type: 'GameOver', winner });
}

/**
 * Add points for `player` (mutates `s`) and emit `ScoreChanged`; ends the game
 * if the mode's target score is reached. Returns whether the game ended.
 */
export function awardPoints(s: GameState, events: GameEvent[], player: Owner, points: number): boolean {
  if (!s.mode || points <= 0) return false;
  s.mode.scores[player] += points;
  events.push({ type: 'ScoreChanged', player, points, scores: [s.mode.scores[0], s.mode.scores[1]] });
  const target = MODE_RULES[s.mode.mode].targetScore;
  if (target !== undefined && s.mode.scores[player] >= target) {
    finishGame(s, events, player, 'score');
    return true;
  }
  return false;
}

/** The King's unit id for `player`, or `undefined` outside kill-the-king. */
export function kingOf(state: GameState, player: Owner): string | undefined {
  return state.mode?.kings?.[player];
}

/** Whether `unitId` is a King (only ever true in kill-the-king). */
export function isKing(state: GameState, unitId: string): boolean {
  const k = state.mode?.kings;
  return !!k && (k[0] === unitId || k[1] === unitId);
}

/**
 * Kill-the-king: the player whose King has fallen (killed or routed), if any.
 * Units are scanned in order, so the answer is deterministic — though one
 * combat only ever costs one side units, so both Kings never fall at once.
 */
export function fallenKingOwner(state: GameState): Owner | undefined {
  const kings = state.mode?.kings;
  if (!kings) return undefined;
  for (const u of state.units) {
    if (u.dead && (u.id === kings[0] || u.id === kings[1])) return u.owner;
  }
  return undefined;
}

/**
 * Called as a round ends (before the next begins). In a mode with a round cap,
 * ending the final round calls the game on points. Returns whether it ended.
 */
export function checkRoundLimit(s: GameState, events: GameEvent[]): boolean {
  if (!s.mode) return false;
  const limit = MODE_RULES[s.mode.mode].roundLimit;
  if (limit === undefined || s.round < limit) return false;
  finishGame(s, events, roundLimitWinner(s), 'roundLimit');
  return true;
}

/** Standing (living, not knocked down) units of player 0 and player 1 on the hexes of `zone`. */
export function standingInZone(state: GameState, zone: ReadonlyArray<Vec>): [number, number] {
  const counts: [number, number] = [0, 0];
  for (const u of state.units) {
    if (u.dead || u.knockedDown) continue;
    if (zone.some((h) => h.x === u.pos.x && h.y === u.pos.y)) counts[u.owner]++;
  }
  return counts;
}

/** The player holding `zone` — strictly more standing units in it — or `undefined` when contested/empty. */
export function zoneController(state: GameState, zone: ReadonlyArray<Vec>): Owner | undefined {
  const [a, b] = standingInZone(state, zone);
  if (a === b) return undefined;
  return a > b ? 0 : 1;
}

/** The zones scored at each round boundary in the current mode (empty outside the zone modes). */
export function scoringZones(state: GameState): Vec[][] {
  const m = state.mode;
  if (m?.mode === 'king-of-the-hill') return m.objectives.hill ? [m.objectives.hill] : [];
  if (m?.mode === 'conquest') return m.objectives.conquest ? [...m.objectives.conquest] : [];
  return [];
}

/**
 * Score the zones at a round boundary (mutates `s`): each zone's controller
 * gains 1 point, zone by zone (conquest's events name the zone index). Called
 * as a round ends — including the final capped round — i.e. at the start of
 * the next round; round 1's start, straight after deploy, is not scored.
 *
 * All zones are tallied before the target is checked, so zone order never
 * decides a game: if both players reach the target on the same boundary the
 * higher score wins, and an equal score goes to {@link tiebreakWinner}.
 * Returns whether a target score ended the game.
 */
export function scoreZones(s: GameState, events: GameEvent[]): boolean {
  const mode = s.mode;
  if (!mode) return false;
  const zones = scoringZones(s);
  const multi = mode.mode === 'conquest';
  zones.forEach((zone, i) => {
    const holder = zoneController(s, zone);
    if (holder === undefined) return;
    mode.scores[holder] += 1;
    const scores: [number, number] = [mode.scores[0], mode.scores[1]];
    events.push(
      multi
        ? { type: 'ScoreChanged', player: holder, points: 1, scores, zone: i }
        : { type: 'ScoreChanged', player: holder, points: 1, scores },
    );
  });
  const target = MODE_RULES[mode.mode].targetScore;
  if (target === undefined) return false;
  const [s0, s1] = mode.scores;
  if (s0 < target && s1 < target) return false;
  finishGame(s, events, s0 === s1 ? tiebreakWinner(s) : s0 > s1 ? 0 : 1, 'score');
  return true;
}

const sameHex = (a: Vec, b: Vec): boolean => a.x === b.x && a.y === b.y;

/** Capture-the-flag: which player's flag `unitId` is carrying, if any. */
export function flagCarriedBy(state: GameState, unitId: string): Owner | undefined {
  const flags = state.mode?.flags;
  if (!flags) return undefined;
  if (flags[0].carrier === unitId) return 0;
  if (flags[1].carrier === unitId) return 1;
  return undefined;
}

/** Capture-the-flag: whether `player`'s flag is sitting on its base hex. */
export function flagAtBase(state: GameState, player: Owner): boolean {
  const m = state.mode;
  if (!m?.flags || !m.objectives.flags) return false;
  return m.flags[player].carrier === null && sameHex(m.flags[player].at, m.objectives.flags[player]);
}

/**
 * Capture-the-flag (mutates `s`): a flag `unit` carries follows it. Being pushed
 * (a recoil) only does this — it never picks up, returns or captures a flag.
 */
export function carryFlags(s: GameState, unit: Unit): void {
  for (const f of s.mode?.flags ?? []) if (f.carrier === unit.id) f.at = { x: unit.pos.x, y: unit.pos.y };
}

/**
 * Capture-the-flag, after `unitId` ends a move (mutates `s`): a carried flag
 * follows its carrier; moving onto your own dropped flag returns it to base;
 * moving onto the enemy flag (at its base or dropped) picks it up; and a carrier
 * ending its move on its own base captures — scoring 1 and winning at once
 * (whether or not its own flag is home). Returns whether the game ended.
 */
export function flagsAfterMove(s: GameState, events: GameEvent[], unitId: string): boolean {
  const m = s.mode;
  const unit = s.units.find((u) => u.id === unitId);
  if (!m?.flags || !m.objectives.flags || !unit) return false;
  const bases = m.objectives.flags;
  const own = unit.owner;
  const enemy: Owner = own === 0 ? 1 : 0;
  carryFlags(s, unit);

  const mine = m.flags[own];
  if (mine.carrier === null && sameHex(mine.at, unit.pos) && !sameHex(mine.at, bases[own])) {
    mine.at = { x: bases[own].x, y: bases[own].y };
    events.push({ type: 'FlagReturned', player: own, unitId: unit.id });
  }
  const theirs = m.flags[enemy];
  if (theirs.carrier === null && sameHex(theirs.at, unit.pos)) {
    theirs.carrier = unit.id;
    events.push({ type: 'FlagPickedUp', player: enemy, unitId: unit.id });
  }
  if (theirs.carrier === unit.id && sameHex(unit.pos, bases[own])) {
    m.scores[own] += 1;
    events.push({ type: 'FlagCaptured', player: own, unitId: unit.id });
    finishGame(s, events, own, 'flag');
    return true;
  }
  return false;
}

/**
 * Capture-the-flag (mutates `s`): a carrier that has been knocked down or has
 * died (killed or routed) drops the flag on its hex. Checked after every
 * combat and activation, before the game-over checks.
 */
export function dropFallenCarriers(s: GameState, events: GameEvent[]): void {
  const flags = s.mode?.flags;
  if (!flags) return;
  flags.forEach((f, p) => {
    if (f.carrier === null) return;
    const carrier = s.units.find((u) => u.id === f.carrier);
    if (carrier && !carrier.dead && !carrier.knockedDown) return;
    const at = carrier ? { x: carrier.pos.x, y: carrier.pos.y } : f.at;
    events.push({ type: 'FlagDropped', player: p as Owner, unitId: f.carrier, at: { x: at.x, y: at.y } });
    f.carrier = null;
    f.at = at;
  });
}
