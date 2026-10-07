import { expect, it } from 'vitest';
import { chooseCommand } from '@fansong/ai';
import {
  createGame,
  getLegalCommands,
  makeHexGrid,
  reduce,
  gameMode,
  MODE_RULES,
  type GameEvent,
  type GameMode,
  type GameState,
} from '@fansong/engine';
import { buildMatch } from '../../src/deploy.js';
import type { MapDef } from '../../src/map.js';
import { getMap, listMaps } from '../../src/mapRegistry.js';
import { PRESET_IDS, getPreset } from '../../src/presets.js';

const STEP_CAP = 20_000;

/**
 * The maps the AI's play is judged on: small ones, flat, wooded and stepped. What the
 * AI does with an objective doesn't need every map, and the big ones take minutes.
 */
export const AI_MAPS: MapDef[] = ['open-field', 'old-forest', 'twin-towers'].map((id) => getMap(id)!);

/** The big maps are slow to play, so the every-map suite gives them one seed, not two. */
const isBig = (map: MapDef) => map.width * map.height > 1000;

/**
 * A seed's matchup: a preset against the same size of the warband `apart` places
 * on (each warband's three sizes sit together in {@link PRESET_IDS}), so the
 * objective modes are played between armies of equal strength.
 */
export function sameSizeMatchup(seed: number, apart: number): [string, string] {
  const n = PRESET_IDS.length;
  return [PRESET_IDS[seed % n]!, PRESET_IDS[(seed + 3 * apart) % n]!];
}

/** Play a full AI-vs-AI game on `map`, checking terrain invariants each step. */
export function playOn(
  map: MapDef,
  seed: number,
  presets: [string, string],
  mode?: GameMode,
  events: GameEvent[] = [],
): GameState {
  let state = createGame(buildMatch(getPreset(presets[0])!, getPreset(presets[1])!, { seed, map, mode }));
  const board = makeHexGrid(state.board);
  let steps = 0;
  while (state.phase !== 'gameOver' && steps < STEP_CAP) {
    const command = chooseCommand(state);
    expect(getLegalCommands(state)).toContainEqual(command);
    const result = reduce(state, command);
    state = result.state;
    events.push(...result.events);
    steps++;
    // Nobody ever stands in a rock or building.
    for (const u of state.units) if (!u.dead) expect(board.isBlocked(u.pos)).toBe(false);
  }
  expect(steps).toBeLessThan(STEP_CAP);
  return state;
}

/** Invariants of a live objective-mode state, checked after every step of a self-play game. */
function checkObjectives(state: GameState, prev: GameState, mode: GameMode): void {
  const rules = MODE_RULES[mode];
  if (mode === 'annihilation') {
    expect(state.mode).toBeUndefined();
    return;
  }
  const m = state.mode!;
  expect(m.mode).toBe(mode);
  // Scores only ever go up, and nobody plays on past the target or the round cap.
  for (const p of [0, 1] as const) expect(m.scores[p]).toBeGreaterThanOrEqual(prev.mode!.scores[p]);
  if (state.phase !== 'gameOver') {
    if (rules.targetScore !== undefined) for (const s of m.scores) expect(s).toBeLessThan(rules.targetScore);
    if (rules.roundLimit !== undefined) expect(state.round).toBeLessThanOrEqual(rules.roundLimit);
  }
  if (mode === 'kill-the-king') {
    // The Kings never change hands, and play goes on only while both stand.
    expect(m.kings).toEqual(prev.mode!.kings);
    m.kings!.forEach((id, p) => expect(state.units.find((u) => u.id === id)?.owner).toBe(p));
    if (state.phase !== 'gameOver') for (const id of m.kings!) expect(state.units.find((u) => u.id === id)!.dead).toBe(false);
  }
  if (mode === 'capture-the-flag') {
    const board = makeHexGrid(state.board);
    m.flags!.forEach((flag, p) => {
      expect(board.isBlocked(flag.at)).toBe(false);
      if (flag.carrier === null) return;
      // Carried by a standing enemy, with the flag on the carrier's hex.
      const carrier = state.units.find((u) => u.id === flag.carrier)!;
      expect(carrier.owner).toBe(1 - p);
      if (state.phase !== 'gameOver') {
        expect(carrier.dead || carrier.knockedDown).toBe(false);
        expect(flag.at).toEqual(carrier.pos);
      }
    });
    // One unit carries at most one flag.
    const [a, b] = m.flags!.map((f) => f.carrier);
    if (a !== null) expect(a).not.toBe(b);
  }
}

const EXPECTED_REASONS: Record<GameMode, string[]> = {
  annihilation: [],
  'kill-the-king': ['king', 'annihilation'],
  'king-of-the-hill': ['score', 'roundLimit', 'annihilation'],
  conquest: ['score', 'roundLimit', 'annihilation'],
  'capture-the-flag': ['flag', 'annihilation'],
  'golden-pig': ['extracted', 'pig', 'roundLimit', 'annihilation'],
};

/** Every built-in map plays `mode` to the end, holding the mode's invariants at every step. */
export function everyMapCompletes(mode: GameMode): void {
  for (const map of listMaps()) {
    it(`${map.id}: ${mode} completes with a consistent result`, () => {
      for (let seed = 11; seed <= (isBig(map) ? 11 : 12); seed++) {
        const presets: [string, string] = sameSizeMatchup(seed, 2);
        let state = createGame(buildMatch(getPreset(presets[0])!, getPreset(presets[1])!, { seed, map, mode }));
        expect(gameMode(state)).toBe(mode);
        const board = makeHexGrid(state.board);
        const events: GameEvent[] = [];
        let steps = 0;
        while (state.phase !== 'gameOver' && steps < STEP_CAP) {
          const result = reduce(state, chooseCommand(state));
          checkObjectives(result.state, state, mode);
          events.push(...result.events);
          state = result.state;
          steps++;
          // Nobody ever stands in a rock or building.
          for (const u of state.units) if (!u.dead) expect(board.isBlocked(u.pos)).toBe(false);
        }
        expect(state.phase).toBe('gameOver');

        const overs = events.filter((e): e is Extract<GameEvent, { type: 'GameOver' }> => e.type === 'GameOver');
        expect(overs).toHaveLength(1);
        const over = overs[0]!;
        expect(over.winner).toBe(state.winner);
        if (mode === 'annihilation') {
          expect(over.reason).toBeUndefined();
          const alive = (p: 0 | 1) => state.units.some((u) => u.owner === p && !u.dead);
          expect(alive(0) && alive(1)).toBe(false);
          continue;
        }
        expect(EXPECTED_REASONS[mode]).toContain(over.reason);

        // The last ScoreChanged event reports the final scores.
        const scores = state.mode!.scores;
        const lastScore = events.filter((e) => e.type === 'ScoreChanged').at(-1);
        if (lastScore?.type === 'ScoreChanged') expect(lastScore.scores).toEqual(scores);
        const w = over.winner;
        const target = MODE_RULES[mode].targetScore;
        if (over.reason === 'score') expect(scores[w]).toBeGreaterThanOrEqual(target!);
        if (over.reason === 'roundLimit') expect(scores[w]).toBeGreaterThanOrEqual(scores[1 - w]!);
        if (over.reason === 'flag') {
          const capture = events.find((e) => e.type === 'FlagCaptured');
          expect(capture?.type === 'FlagCaptured' && capture.player).toBe(w);
        }
        if (over.reason === 'king') {
          const [k0, k1] = state.mode!.kings!;
          expect(state.units.find((u) => u.id === (w === 0 ? k1 : k0))!.dead).toBe(true);
        }
      }
    });
  }
}

/** The AI holds the zones of `mode` for a good share of the rounds. */
export function aiScoresZones(mode: 'king-of-the-hill' | 'conquest'): void {
  for (const map of AI_MAPS) {
    it(`${map.id}: ${mode} games complete within the round cap, and the AI actually scores`, () => {
      let scored = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const events: GameEvent[] = [];
        const final = playOn(map, seed, sameSizeMatchup(seed, 1), mode, events);
        expect(final.phase).toBe('gameOver');
        expect(final.round).toBeLessThanOrEqual(12);
        expect(events.some((e) => e.type === 'GameOver')).toBe(true);
        scored += events.filter((e) => e.type === 'ScoreChanged').length;
      }
      // Zone-seeking AIs hold zones for a good share of the rounds.
      expect(scored).toBeGreaterThanOrEqual(6);
    });
  }
}
