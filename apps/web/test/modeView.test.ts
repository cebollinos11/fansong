import { createMatchFromPresets, type MatchSetup } from '@fansong/content';
import type { GameMode, GameState } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { modeHud, modeMarkers, modeMarkingsKey, modeOverlays, unitBadges } from '../src/ui/modeView.js';

function match(mode: GameMode | undefined, mapId?: string): GameState {
  const setup: MatchSetup = { presets: ['iron-wardens', 'ashfang-raiders'], seats: ['ai', 'ai'], seed: 5 };
  return createMatchFromPresets({ ...setup, ...(mapId ? { mapId } : {}), ...(mode ? { mode } : {}) });
}

describe('annihilation', () => {
  it('shows no mode panel and no markings', () => {
    const s = match(undefined);
    expect(modeHud(s)).toBeNull();
    expect(modeOverlays(s)).toEqual([]);
    expect(modeMarkers(s)).toEqual([]);
    expect(unitBadges(s)).toEqual({});
  });
});

describe('kill-the-king', () => {
  it('names both Kings and crowns them while alive', () => {
    const s = match('kill-the-king');
    const [k0, k1] = s.mode!.kings!;
    const hud = modeHud(s)!;
    expect(hud.label).toBe('Kill the king');
    expect(hud.scores).toBeNull();
    expect(hud.lines).toHaveLength(2);
    expect(hud.lines[0]).toMatch(/^P0 King: /);
    expect(unitBadges(s)).toEqual({ [k0]: 'crown', [k1]: 'crown' });

    const before = modeMarkingsKey(s);
    s.units.find((u) => u.id === k1)!.dead = true;
    expect(modeHud(s)!.lines[1]).toMatch(/\(fallen\)$/);
    expect(unitBadges(s)).toEqual({ [k0]: 'crown' });
    expect(modeMarkingsKey(s)).not.toBe(before);
  });
});

describe('king-of-the-hill', () => {
  it('shows scores, the goal, the holder and the hill overlay', () => {
    const s = match('king-of-the-hill', 'rolling-hills');
    const hud = modeHud(s)!;
    expect(hud.scores).toEqual([0, 0]);
    expect(hud.goal).toBe('First to 5 points · ends after round 12');
    expect(hud.lines).toEqual(['Hill: —']);

    const hill = s.mode!.objectives.hill!;
    const unit = s.units.find((u) => u.owner === 1)!;
    unit.pos = { ...hill[0]! };
    s.mode!.scores = [1, 3];
    expect(modeHud(s)!.lines).toEqual(['Hill: P1']);
    expect(modeHud(s)!.scores).toEqual([1, 3]);
    expect(modeOverlays(s)).toEqual([expect.objectContaining({ cells: hill })]);
  });
});

describe('conquest', () => {
  it('lists zones A/B/C and tints all three', () => {
    const s = match('conquest', 'crossroads');
    const hud = modeHud(s)!;
    expect(hud.goal).toMatch(/^First to 8 points/);
    expect(hud.lines).toEqual(['A: — · B: — · C: —']);
    expect(modeOverlays(s)).toHaveLength(3);
  });
});

describe('capture-the-flag', () => {
  it('tracks flags at base, carried and dropped', () => {
    const s = match('capture-the-flag', 'twin-towers');
    const bases = s.mode!.objectives.flags!;
    expect(modeHud(s)!.lines).toEqual(['P0 flag: at base', 'P1 flag: at base']);
    expect(modeMarkers(s)).toEqual([
      { kind: 'flag', owner: 0, cell: bases[0] },
      { kind: 'flag', owner: 1, cell: bases[1] },
    ]);
    // Base hexes are tinted too.
    expect(modeOverlays(s)).toHaveLength(2);
    const atStart = modeMarkingsKey(s);

    // A P0 unit carries P1's flag.
    const carrier = s.units.find((u) => u.owner === 0)!;
    s.mode!.flags![1] = { at: { ...carrier.pos }, carrier: carrier.id };
    expect(modeHud(s)!.lines[1]).toBe(`P1 flag: carried by ${carrier.name} (P0)`);
    expect(modeMarkers(s)).toEqual([{ kind: 'flag', owner: 0, cell: bases[0] }]);
    expect(unitBadges(s)).toEqual({ [carrier.id]: 'flag-1' });
    expect(modeMarkingsKey(s)).not.toBe(atStart);

    // Dropped.
    s.mode!.flags![1] = { at: { x: 4, y: 3 }, carrier: null };
    expect(modeHud(s)!.lines[1]).toBe('P1 flag: dropped at (4, 3)');
    expect(modeMarkers(s)).toContainEqual({ kind: 'flag', owner: 1, cell: { x: 4, y: 3 } });
    expect(unitBadges(s)).toEqual({});
  });
});
