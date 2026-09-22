import { createMatchFromPresets, type MatchSetup } from '@fansong/content';
import type { GameEvent, GameMode, GameState } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { appendEvents, eventTone, formatEvent, latestCallout } from '../src/ui/log.js';

function match(mode: GameMode | undefined, mapId?: string): GameState {
  const setup: MatchSetup = { presets: ['iron-wardens', 'ashfang-raiders'], seats: ['ai', 'ai'], seed: 5 };
  return createMatchFromPresets({ ...setup, ...(mapId ? { mapId } : {}), ...(mode ? { mode } : {}) });
}

describe('objective log text', () => {
  it('names the hill in king-of-the-hill scoring', () => {
    const s = match('king-of-the-hill', 'rolling-hills');
    const e: GameEvent = { type: 'ScoreChanged', player: 1, points: 1, scores: [2, 3] };
    expect(formatEvent(s, e)).toBe('  ★ Player 1 scores 1 for holding the hill (2–3)');
  });

  it('letters conquest zones like the HUD', () => {
    const s = match('conquest', 'crossroads');
    const e: GameEvent = { type: 'ScoreChanged', player: 0, points: 1, scores: [4, 1], zone: 2 };
    expect(formatEvent(s, e)).toBe('  ★ Player 0 scores 1 for holding zone C (4–1)');
  });

  it('tags flag events with the unit owner and drop position', () => {
    const s = match('capture-the-flag', 'twin-towers');
    const u = s.units.find((x) => x.owner === 1)!;
    expect(formatEvent(s, { type: 'FlagPickedUp', player: 0, unitId: u.id })).toBe(
      `  ⚑ ${u.name} (P1) seizes Player 0's flag`,
    );
    expect(formatEvent(s, { type: 'FlagDropped', player: 0, unitId: u.id, at: { x: 3, y: 4 } })).toBe(
      `  ⚑ ${u.name} (P1) drops Player 0's flag at (3, 4)`,
    );
    expect(formatEvent(s, { type: 'FlagCaptured', player: 1, unitId: u.id })).toMatch(/Player 1 captures it!$/);
  });

  it('explains why the game ended only in objective modes', () => {
    const s = match(undefined);
    expect(formatEvent(s, { type: 'GameOver', winner: 0 })).toBe('GAME OVER — Player 0 wins');
    expect(formatEvent(s, { type: 'GameOver', winner: 1, reason: 'king' })).toBe(
      'GAME OVER — Player 1 wins (the King has fallen)',
    );
  });
});

describe('log tones and callout', () => {
  it('emphasises scoring, flag and game-over lines only', () => {
    expect(eventTone({ type: 'ScoreChanged', player: 0, points: 1, scores: [1, 0] })).toBe('objective');
    expect(eventTone({ type: 'FlagReturned', player: 0, unitId: 'x' })).toBe('objective');
    expect(eventTone({ type: 'GameOver', winner: 0 })).toBe('end');
    expect(eventTone({ type: 'UnitKilled', unitId: 'x', byId: null })).toBeUndefined();
  });

  it('keeps ordinary entries tone-free and surfaces the newest emphasised one', () => {
    const s = match('king-of-the-hill', 'rolling-hills');
    const log = appendEvents([], s, [
      { type: 'ScoreChanged', player: 0, points: 1, scores: [1, 0] },
      { type: 'RoundEnded', round: 1, nextLeader: 1 },
    ]);
    expect(log).toHaveLength(2);
    expect(log[0]!.tone).toBe('objective');
    expect('tone' in log[1]!).toBe(false);
    expect(latestCallout(log)).toBe(log[0]);
    expect(latestCallout(log.slice(1))).toBeNull();
  });
});
