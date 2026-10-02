import { createMatchFromPresets } from '@fansong/content';
import { reduce, type GameMode, type GameState } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { splitRoundScoring } from '../src/game/roundScoring.js';

function match(mode: GameMode, mapId: string): GameState {
  return createMatchFromPresets({ presets: ['iron-wardens-medium', 'ashfang-raiders-medium'], seats: ['ai', 'ai'], seed: 5, mapId, mode });
}

/** End the round with a bare EndActivation, every unit already spent. */
function endRound(s: GameState) {
  for (const u of s.units) u.activatedThisRound = true;
  s.active = 1;
  s.activeUnitId = s.units.find((u) => u.owner === 1)!.id;
  s.phase = 'acting';
  s.actionsRemaining = 1;
  return reduce(s, { type: 'EndActivation' });
}

describe('splitRoundScoring', () => {
  it('scores conquest zone by zone, the unheld ones included, before the round ends', () => {
    const s = match('conquest', 'crossroads');
    const [a, , c] = s.mode!.objectives.conquest!;
    const [p0, p1] = [s.units.filter((u) => u.owner === 0), s.units.filter((u) => u.owner === 1)];
    // Zone A to player 0; zone B empty; zone C to player 1.
    p0[0]!.pos = { ...a[0]! };
    p1[0]!.pos = { ...c[0]! };
    s.mode!.scores = [2, 1];
    const t = endRound(s);
    expect(t.state.mode!.scores).toEqual([3, 2]);

    const parts = splitRoundScoring({ ...t, command: { type: 'EndActivation' } });
    const zones = parts.filter((p) => p.scoring);
    expect(zones.map((p) => p.scoring!.holder)).toEqual([0, undefined, 1]);
    expect(zones.map((p) => p.scoring!.points)).toEqual([1, 0, 1]);
    expect(zones.map((p) => p.state.mode!.scores)).toEqual([[3, 1], [3, 1], [3, 2]]);
    expect(zones.map((p) => p.events.map((e) => e.type))).toEqual([['ScoreChanged'], [], ['ScoreChanged']]);
    // The round has not turned over while they are counted.
    expect(zones.every((p) => p.state.round === 1)).toBe(true);

    const last = parts.at(-1)!;
    expect(last.state).toBe(t.state);
    expect(last.events[0]?.type).toBe('RoundEnded');
    expect(parts[0]!.command).toEqual({ type: 'EndActivation' });
    // Every event is played exactly once, in order.
    expect(parts.flatMap((p) => p.events)).toEqual(t.events);
  });

  it('holds the game-over back until the winning point has been shown', () => {
    const s = match('king-of-the-hill', 'rolling-hills');
    s.units.find((u) => u.owner === 0)!.pos = { ...s.mode!.objectives.hill![0]! };
    s.mode!.scores = [4, 0];
    const t = endRound(s);
    expect(t.state.phase).toBe('gameOver');

    const parts = splitRoundScoring(t);
    const zone = parts.find((p) => p.scoring)!;
    expect(zone.scoring).toMatchObject({ holder: 0, points: 1, counts: [1, 0] });
    expect(zone.state.mode!.scores).toEqual([5, 0]);
    expect(zone.state.phase).not.toBe('gameOver');
    expect(zone.state.winner).toBeNull();
    expect(parts.at(-1)!.events).toEqual([{ type: 'GameOver', winner: 0, reason: 'score' }]);
  });

  it('leaves other modes and mid-round transitions alone', () => {
    const flat = endRound(match('kill-the-king', 'crossroads'));
    expect(splitRoundScoring(flat)).toEqual([flat]);

    const s = match('conquest', 'crossroads');
    const unit = s.units.find((u) => u.owner === s.active)!;
    const mid = reduce(s, { type: 'ChooseActivation', unitId: unit.id, diceCount: 1 });
    expect(splitRoundScoring(mid)).toEqual([mid]);
  });
});
