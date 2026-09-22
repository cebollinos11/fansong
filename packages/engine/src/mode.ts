import type { Vec } from './board.js';
import { livingCount } from './query.js';
import type { GameEvent, GameOverReason, GameState, Owner } from './types.js';

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
  if (state.mode?.mode === 'king-of-the-hill') return state.mode.objectives.hill ? [state.mode.objectives.hill] : [];
  return [];
}

/**
 * Score the zones at a round boundary (mutates `s`): each zone's controller
 * gains 1 point. Called as a round ends — including the final capped round —
 * i.e. at the start of the next round; round 1's start, straight after deploy,
 * is not scored. Returns whether a target score ended the game.
 */
export function scoreZones(s: GameState, events: GameEvent[]): boolean {
  for (const zone of scoringZones(s)) {
    const holder = zoneController(s, zone);
    if (holder !== undefined && awardPoints(s, events, holder, 1)) return true;
  }
  return false;
}
