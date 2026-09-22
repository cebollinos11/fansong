import { createMatchFromPresets, type MatchSetup } from '@fansong/content';
import type { GameEvent, GameState } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { describeHex } from '../src/ui/hexInfo.js';
import { formatEvent } from '../src/ui/log.js';

const SETUP: MatchSetup = {
  presets: ['iron-wardens', 'ashfang-raiders'],
  seats: ['human', 'ai'],
  seed: 42,
};

function withTerrain(state: GameState): GameState {
  return {
    ...state,
    board: {
      ...state.board,
      blocked: ['0,0'],
      terrain: { '1,1': { elevation: 2, feature: 'forest' }, '2,1': { feature: 'rock' }, '3,1': { elevation: 1 } },
    },
  };
}

describe('describeHex', () => {
  const state = withTerrain(createMatchFromPresets(SETUP));

  it('reports elevation and feature', () => {
    expect(describeHex(state, { x: 1, y: 1 })).toEqual({
      title: 'Hex (1, 1)',
      lines: ['Elevation 2 — high ground', 'Forest — blocks sight through it'],
    });
    expect(describeHex(state, { x: 2, y: 1 })?.lines).toEqual(['Elevation 0', 'Rocks — impassable, blocks sight']);
    expect(describeHex(state, { x: 3, y: 1 })?.lines).toEqual(['Elevation 1 — high ground']);
    expect(describeHex(state, { x: 0, y: 0 })?.lines).toContain('Blocked — impassable, blocks sight');
  });

  it('names a living unit standing on the hex', () => {
    const u = state.units[0]!;
    const info = describeHex(state, u.pos);
    expect(info?.lines.at(-1)).toBe(`${u.name} (P${u.owner})`);
  });

  it('is null off the board', () => {
    expect(describeHex(state, { x: -1, y: 0 })).toBeNull();
    expect(describeHex(state, { x: state.board.width, y: 0 })).toBeNull();
  });
});

describe('formatEvent high ground', () => {
  const state = createMatchFromPresets(SETUP);
  const [a, b] = [state.units[0]!, state.units.find((u) => u.owner === 1)!];

  it('mentions a high-ground bonus only when present', () => {
    const base = {
      attackerId: a.id,
      targetId: b.id,
      attackDie: 3,
      defenseDie: 2,
      attackScore: 7,
      defenseScore: 5,
      result: 'defenderKnockedDown',
    } as const;
    const plain = formatEvent(state, { type: 'AttackResolved', ...base } as GameEvent);
    expect(plain).not.toMatch(/high ground/);
    const up = formatEvent(state, { type: 'AttackResolved', ...base, attackBonus: 1 } as GameEvent);
    expect(up).toContain(`${a.name} (7, +1 high ground) attacks ${b.name} (5)`);
    const shot = formatEvent(state, { type: 'ShotResolved', ...base, defenseBonus: 1 } as GameEvent);
    expect(shot).toContain(`shoots ${b.name} (5, +1 high ground)`);
    const riposte = formatEvent(state, {
      type: 'GuardRiposte',
      guardId: b.id,
      attackerId: a.id,
      guardDie: 4,
      attackerDie: 1,
      guardScore: 8,
      attackerScore: 4,
      guardBonus: 1,
      result: 'defenderKnockedDown',
      prevented: true,
    } as GameEvent);
    expect(riposte).toContain(`${b.name} (8, +1 high ground) ripostes ${a.name} (4)`);
  });
});
