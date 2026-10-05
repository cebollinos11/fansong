import { createMatchFromPresets, type MatchSetup } from '@fansong/content';
import { unitMove, type GameState, type Unit, type Vec } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { describeHex, oddsLine, type HexLine, type HexScore } from '../src/ui/hexInfo.js';
import { modifierHelp } from '../src/ui/rollView.js';
import type { PlanPreview } from '../src/game/planView.js';
import { INSPIRED_HELP, TRAIT_HELP } from '../src/ui/hudView.js';

const SETUP: MatchSetup = {
  presets: ['iron-wardens-medium', 'ashfang-raiders-medium'],
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
    // Every preset unit has an ability now, so strip the first unit's to get a plain one.
    const first = state.units[0]!;
    const noTraits = Object.fromEntries(Object.keys(first.traits).map((k) => [k, k === 'ranged' ? 0 : false])) as unknown as Unit['traits'];
    const plain: Unit = { ...first, traits: noTraits };
    const bare: GameState = { ...state, units: state.units.map((u) => (u.id === plain.id ? plain : u)) };
    // A unit with no abilities says nothing extra.
    expect(describeHex(bare, plain.pos)?.lines.at(-1)).toEqual({ quality: plain.quality, combat: plain.combat, move: unitMove(plain) });

    const armed: GameState = {
      ...bare,
      units: bare.units.map((u) =>
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

  it('marks an inspired unit, and held on it, says the sure 6 can still turn over', () => {
    const u = state.units[0]!;
    const inspired: GameState = { ...state, units: state.units.map((x) => (x.id === u.id ? { ...x, inspired: true } : x)) };
    expect(describeHex(inspired, u.pos)?.lines).toContain('Inspired');
    const detailed = describeHex(inspired, u.pos, null, true)?.lines ?? [];
    expect(detailed).not.toContain('Inspired');
    expect(detailed).toContainEqual({ trait: 'Inspired', help: INSPIRED_HELP });
    expect(INSPIRED_HELP).toMatch(/sure 6/);
    expect(INSPIRED_HELP).toMatch(/two failures .* still turn it over/);
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

  it("shows each side's modifiers, and spells them out once the pointer rests", () => {
    // The striker at (3,2) and a friend at (3,4) catch the target at (3,3) between them.
    const [a, friend] = state.units.filter((u) => u.owner === 0);
    const target = state.units.find((u) => u.owner === 1)!;
    const at: Record<string, Vec> = { [a!.id]: { x: 3, y: 2 }, [friend!.id]: { x: 3, y: 4 }, [target.id]: { x: 3, y: 3 } };
    const live: GameState = {
      ...state,
      board: { ...state.board, terrain: {}, blocked: [] },
      phase: 'acting',
      activeUnitId: a!.id,
      units: state.units.map((u) => ({ ...u, pos: at[u.id] ?? { x: 20 + state.units.indexOf(u), y: 20 } })),
    };
    const here = { x: 3, y: 2 };
    const plan: PlanPreview = { kind: 'attack', cost: 1, path: [here], waypoints: [], provokes: 0, targetId: target.id };
    const quick = describeHex(live, at[target.id]!, plan)!.lines;
    const scores = quick.filter((l): l is HexScore => typeof l === 'object' && 'mods' in l);
    expect(scores.map((l) => l.name)).toEqual([a!.name, target.name]);
    const [mine, theirs] = scores;
    expect(mine!.mods[0]).toEqual({ label: 'Combat', value: a!.combat });
    expect(mine!.mods).toContainEqual({ label: 'Pincer', value: 1 });
    expect(mine!.total).toBe(mine!.mods.reduce((sum, m) => sum + m.value, 0));
    expect(theirs!.mods[0]).toEqual({ label: 'Combat', value: target.combat });
    // The quick glance names the modifiers; resting on the hex says what they are.
    expect(quick.some((l) => typeof l === 'object' && 'trait' in l && l.trait === '+1 Pincer')).toBe(false);
    const rested = describeHex(live, at[target.id]!, plan, true)!.lines;
    expect(rested).toContainEqual({ trait: '+1 Pincer', help: modifierHelp('Pincer') });
  });

  it('leaves the tooltip alone when there is no plan for the hex', () => {
    expect(describeHex(state, cell)!.lines).toEqual(describeHex(state, cell, null)!.lines);
  });
});
