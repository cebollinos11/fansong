import { createMatchFromPresets, type MatchSetup } from '@fansong/content';
import { unitMove, type GameState } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { describeHex, oddsLine, type HexLine } from '../src/ui/hexInfo.js';
import type { PlanPreview } from '../src/game/planView.js';
import { TRAIT_HELP } from '../src/ui/hudView.js';

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

  it('names a living unit standing on the hex, with its stats, but not its hex, height or owner', () => {
    const u = state.units[0]!;
    const info = describeHex(state, u.pos);
    expect(info?.title).toBe(u.name);
    expect(info?.lines.join(' ')).not.toMatch(/Elevation|\(P\d\)/);
    expect(info?.lines).toContainEqual({ quality: u.quality, combat: u.combat, move: unitMove(u) });
  });

  it('spells out the abilities that change how a unit must be fought', () => {
    const plain = state.units[0]!;
    // A unit with no abilities says nothing extra.
    expect(describeHex(state, plain.pos)?.lines.at(-1)).toEqual({ quality: plain.quality, combat: plain.combat, move: unitMove(plain) });

    const armed: GameState = {
      ...state,
      units: state.units.map((u) =>
        u.id === plain.id
          ? { ...u, guarding: true, traits: { ...u.traits, ranged: 4, tough: true, guard: true, big: true } }
          : u,
      ),
    };
    const lines = describeHex(armed, plain.pos)?.lines ?? [];
    expect(lines).toContain('On guard');
    expect(lines.at(-1)).toBe('Ranged 4 · Tough · Guard · Big');

    // Held on the hex, each ability is spelled out in place of the one-line list.
    const detailed = describeHex(armed, plain.pos, null, true)?.lines ?? [];
    expect(detailed).not.toContain('Ranged 4 · Tough · Guard · Big');
    expect(detailed.slice(-4)).toEqual([
      { trait: 'Ranged 4', help: TRAIT_HELP.ranged },
      { trait: 'Tough', help: TRAIT_HELP.tough },
      { trait: 'Guard', help: TRAIT_HELP.guard },
      { trait: 'Big', help: TRAIT_HELP.big },
    ]);
  });

  it('in a match, leaves out coordinates and elevation, and says nothing of a bare hex', () => {
    expect(describeHex(state, { x: 1, y: 1 }, null, false, 'match')).toEqual({
      title: 'Forest — blocks sight through it',
      lines: [],
    });
    expect(describeHex(state, { x: 3, y: 1 }, null, false, 'match')).toBeNull();
    const at = { x: 3, y: 1 };
    const plan: PlanPreview = { kind: 'move', cost: 1, path: [at], waypoints: [at], provokes: 0 };
    expect(describeHex(state, at, plan, false, 'match')?.title).toMatch(/^Move here/);
  });

  it('is null off the board', () => {
    expect(describeHex(state, { x: -1, y: 0 })).toBeNull();
    expect(describeHex(state, { x: state.board.width, y: 0 })).toBeNull();
  });
});

describe('describeHex with a plan', () => {
  const state = { ...createMatchFromPresets(SETUP), actionsRemaining: 3 };
  const cell = { x: 4, y: 4 };
  const lines = (plan: PlanPreview): HexLine[] => describeHex(state, cell, plan)!.lines;

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

  it('quotes the odds of the fight a click would start', () => {
    const attacker = state.units.find((u) => u.owner === 0)!;
    const target = state.units.find((u) => u.owner === 1)!;
    const live = { ...state, phase: 'acting' as const, activeUnitId: attacker.id };
    const attack = describeHex(live, cell, { ...base, kind: 'attack', cost: 2, targetId: target.id })!.lines;
    expect(attack.some((l) => typeof l === 'string' && /^Win \d+%.* · lose \d+%$/.test(l))).toBe(true);
    const shot = describeHex(live, cell, { ...base, kind: 'shoot', cost: 2, targetId: target.id })!.lines;
    expect(shot.some((l) => typeof l === 'string' && /^Win \d+%.* · no risk$/.test(l))).toBe(true);
    // No odds for a walk, nor without an activating unit to fight.
    expect(lines({ ...base, kind: 'attack', cost: 2, targetId: target.id }).join(' ')).not.toContain('Win');
  });

  it('quotes a pressed blow at its own, better odds for the attack menu', () => {
    const attacker = state.units.find((u) => u.owner === 0)!;
    const target = state.units.find((u) => u.owner === 1)!;
    const live = { ...state, phase: 'acting' as const, activeUnitId: attacker.id };
    const win = (line: string | null): number => Number(/^Win (\d+)%/.exec(line ?? '')?.[1]);
    const plan = { ...base, kind: 'attack' as const, cost: 1, targetId: target.id };
    const plain = oddsLine(live, plan);
    const pressed = oddsLine(live, { ...plan, pressed: true });
    expect(plain).toMatch(/^Win \d+%/);
    expect(win(pressed)).toBeGreaterThan(win(plain));
  });

  it('leaves the tooltip alone when there is no plan for the hex', () => {
    expect(describeHex(state, cell)!.lines).toEqual(describeHex(state, cell, null)!.lines);
  });
});
