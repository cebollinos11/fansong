import { createMatchFromPresets, type MatchSetup } from '@fansong/content';
import type { GameEvent, GameState } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { describeHex } from '../src/ui/hexInfo.js';
import type { PlanPreview } from '../src/game/planView.js';
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

  it('names a living unit standing on the hex, with its stats', () => {
    const u = state.units[0]!;
    const info = describeHex(state, u.pos);
    expect(info?.lines).toContain(`${u.name} (P${u.owner})`);
    expect(info?.lines).toContain(`Q${u.quality} · C${u.combat} · M${u.move}`);
  });

  it('spells out the abilities that change how a unit must be fought', () => {
    const plain = state.units[0]!;
    // A unit with no abilities says nothing extra.
    expect(describeHex(state, plain.pos)?.lines.at(-1)).toBe(`Q${plain.quality} · C${plain.combat} · M${plain.move}`);

    const armed: GameState = {
      ...state,
      units: state.units.map((u) =>
        u.id === plain.id
          ? { ...u, guarding: true, traits: { ranged: 4, tough: true, guard: true, big: true } }
          : u,
      ),
    };
    const lines = describeHex(armed, plain.pos)?.lines ?? [];
    expect(lines).toContain(`${plain.name} (P${plain.owner}) · on guard`);
    expect(lines.at(-1)).toBe('Ranged 4 · Tough · Guard · Big');
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

describe('describeHex with a plan', () => {
  const state = { ...createMatchFromPresets(SETUP), actionsRemaining: 3 };
  const cell = { x: 4, y: 4 };
  const lines = (plan: PlanPreview): string[] => describeHex(state, cell, plan)!.lines;

  const base = { path: [cell], waypoints: [cell], provokes: 0 };

  it('prices a walk and says what is left over', () => {
    expect(lines({ ...base, kind: 'move', cost: 2 })).toContain('Move here — 2 actions (1 action left)');
  });

  it('spends the lot without promising leftovers', () => {
    expect(lines({ ...base, kind: 'move', cost: 3 })).toContain('Move here — 3 actions');
    expect(lines({ ...base, kind: 'move', cost: 3 }).join(' ')).not.toContain('left');
  });

  it('calls a blow you walk to a charge, and names the target', () => {
    const target = state.units.find((u) => u.owner === 1)!;
    expect(lines({ ...base, kind: 'attack', cost: 2, targetId: target.id })).toContain(
      `Charge ${target.name} — 2 actions (1 action left)`,
    );
    // Standing still, it is just an attack.
    expect(lines({ ...base, kind: 'attack', cost: 1, waypoints: [], targetId: target.id })).toContain(
      `Attack ${target.name} — 1 action (2 actions left)`,
    );
  });

  it('warns when the route breaks away from an enemy', () => {
    expect(lines({ ...base, kind: 'move', cost: 2, provokes: 1 })).toContain(
      'Breaking away — risks a parting blow',
    );
    expect(lines({ ...base, kind: 'move', cost: 2 })).not.toContain(
      'Breaking away — risks a parting blow',
    );
  });

  it('leaves the tooltip alone when there is no plan for the hex', () => {
    expect(describeHex(state, cell)!.lines).toEqual(describeHex(state, cell, null)!.lines);
  });
});
