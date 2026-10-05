import { createMatchFromPresets, type MatchSetup } from '@fansong/content';
import type { GameMode, GameState } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { zoneTallies } from '../src/game/roundScoring.js';
import { ZONE_COLORS } from '../src/ui/editorView.js';
import { modeHud, modeMarkers, modeMarkingsKey, modeOverlays, PIG_GOAL_COLOR, unitBadges, zoneScore } from '../src/ui/modeView.js';

/** What the sides are called against the AI, as the top bar shows them. */
const VS_AI = ['You', 'AI'] as const;

function match(mode: GameMode | undefined, mapId?: string): GameState {
  const setup: MatchSetup = { presets: ['iron-wardens-medium', 'ashfang-raiders-medium'], seats: ['ai', 'ai'], seed: 5 };
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

describe('inspired badge', () => {
  it('stars an inspired unit, behind a Guard badge', () => {
    const s = match(undefined);
    const before = modeMarkingsKey(s);
    const [a, b] = s.units;
    a!.inspired = true;
    b!.inspired = true;
    b!.guarding = true;
    expect(unitBadges(s)).toEqual({ [a!.id]: 'inspired', [b!.id]: 'guard' });
    expect(modeMarkingsKey(s)).not.toBe(before);
    a!.dead = true;
    expect(unitBadges(s)).toEqual({ [b!.id]: 'guard' });
  });
});

describe('guard badge', () => {
  it('badges a guarding unit even with no game mode in play', () => {
    const s = match(undefined);
    const before = modeMarkingsKey(s);
    const unit = s.units[0]!;
    unit.guarding = true;
    expect(unitBadges(s)).toEqual({ [unit.id]: 'guard' });
    expect(modeMarkingsKey(s)).not.toBe(before);

    unit.guarding = false;
    expect(unitBadges(s)).toEqual({});
  });

  it('drops the badge once the unit is dead, without needing guarding cleared', () => {
    const s = match(undefined);
    const unit = s.units[0]!;
    unit.guarding = true;
    unit.dead = true;
    expect(unitBadges(s)).toEqual({});
  });

  it('lets a King (or flag carrier) keep its own badge over Guard', () => {
    const s = match('kill-the-king');
    const [k0, k1] = s.mode!.kings!;
    s.units.find((u) => u.id === k0)!.guarding = true;
    expect(unitBadges(s)).toEqual({ [k0]: 'crown', [k1]: 'crown' });
  });
});

describe('kill-the-king', () => {
  it('names both Kings and crowns them while alive', () => {
    const s = match('kill-the-king');
    const [k0, k1] = s.mode!.kings!;
    const hud = modeHud(s, VS_AI)!;
    expect(hud.label).toBe('Kill the king');
    expect(hud.scores).toBeNull();
    expect(hud.lines).toHaveLength(2);
    expect(hud.lines[0]).toMatch(/^Your King: /);
    expect(hud.lines[1]).toMatch(/^AI's King: /);
    expect(modeHud(s)!.lines[0]).toMatch(/^Blue's King: /);
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
    expect(modeOverlays(s)).toEqual([expect.objectContaining({ cells: hill, color: ZONE_COLORS.hill })]);
    const unheld = modeMarkingsKey(s);
    const unit = s.units.find((u) => u.owner === 1)!;
    unit.pos = { ...hill[0]! };
    s.mode!.scores = [1, 3];
    expect(modeHud(s, VS_AI)!.lines).toEqual(['Hill: AI']);
    expect(modeHud(s)!.lines).toEqual(['Hill: Red']);
    expect(modeHud(s)!.scores).toEqual([1, 3]);
    // Held: rimmed in the holder's colour, under the hill's own tint.
    expect(modeOverlays(s)).toEqual([
      expect.objectContaining({ cells: hill, color: ZONE_COLORS.deploy[1] }),
      expect.objectContaining({ cells: hill, color: ZONE_COLORS.hill }),
    ]);
    expect(modeMarkingsKey(s)).not.toBe(unheld);
  });

  it('words a zone being scored: who takes the point, or why nobody does', () => {
    const s = match('king-of-the-hill', 'rolling-hills');
    const hill = s.mode!.objectives.hill!;
    const names = ['You', 'AI'] as const;
    const tally = () => ({ ...zoneTallies(s)[0]!, points: 1 });

    expect(zoneScore(s, { ...tally(), points: 0 }, names)).toMatchObject({
      name: 'The hill',
      owner: null,
      headline: 'No points',
      reason: 'nobody standing in it',
    });

    const [mine, theirs] = [s.units.find((u) => u.owner === 0)!, s.units.find((u) => u.owner === 1)!];
    mine.pos = { ...hill[0]! };
    expect(zoneScore(s, tally(), names)).toMatchObject({ owner: 0, headline: '+1 You', counts: [1, 0] });

    theirs.pos = { ...hill[1]! };
    expect(zoneScore(s, { ...tally(), points: 0 }, names)).toMatchObject({
      owner: null,
      counts: [1, 1],
      reason: 'contested: equal numbers standing in it',
    });

    // A knocked-down unit holds nothing.
    mine.knockedDown = true;
    expect(zoneScore(s, tally(), names)).toMatchObject({ owner: 1, headline: '+1 AI', counts: [0, 1] });
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
    expect(modeHud(s, VS_AI)!.lines).toEqual(['Your flag: at base', "AI's flag: at base"]);
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
    expect(modeHud(s, VS_AI)!.lines[1]).toBe(`AI's flag: carried by ${carrier.name} (You)`);
    expect(modeMarkers(s)).toEqual([{ kind: 'flag', owner: 0, cell: bases[0] }]);
    expect(unitBadges(s)).toEqual({ [carrier.id]: 'flag-1' });
    expect(modeMarkingsKey(s)).not.toBe(atStart);

    // Dropped.
    s.mode!.flags![1] = { at: { x: 4, y: 3 }, carrier: null };
    expect(modeHud(s)!.lines[1]).toBe("Red's flag: dropped at (4, 3)");
    expect(modeMarkers(s)).toContainEqual({ kind: 'flag', owner: 1, cell: { x: 4, y: 3 } });
    expect(unitBadges(s)).toEqual({});
  });
});

describe('extract the golden Pig', () => {
  const pigMatch = (escort?: 0 | 1): GameState =>
    createMatchFromPresets({
      presets: ['iron-wardens-medium', 'ashfang-raiders-medium'],
      seats: ['ai', 'ai'],
      seed: 5,
      mapId: 'old-forest',
      mode: 'golden-pig',
      ...(escort === undefined ? {} : { escort }),
    });

  it('shows the goal with its round limit, who escorts, and how the Pig fares', () => {
    const s = pigMatch(1);
    const hud = modeHud(s)!;
    expect(hud.label).toBe('Extract the golden Pig');
    expect(hud.goal).toBe(`Get the golden Pig into the enemy camp · ends after round ${s.limits!.roundLimit}`);
    expect(hud.scores).toBeNull();
    expect(hud.lines).toEqual(['Red escorts the Pig', 'Blue wins by killing it, or when time runs out']);
    expect(modeHud(s, VS_AI)!.lines).toEqual(['AI escorts the Pig', 'You win by killing it, or when time runs out']);
    const pig = s.units.find((u) => u.id === s.mode!.pig!.unitId)!;
    pig.knockedDown = true;
    expect(modeHud(s)!.lines[0]).toBe('Red escorts the Pig (knocked down)');
  });

  it('tints the goal zone, crowns the living Pig and redraws when it falls', () => {
    const s = pigMatch();
    const id = s.mode!.pig!.unitId;
    expect(modeOverlays(s)).toEqual([expect.objectContaining({ cells: s.mode!.objectives.extraction, color: PIG_GOAL_COLOR })]);
    expect(modeMarkers(s)).toEqual([]);
    expect(unitBadges(s)).toEqual({ [id]: 'crown' });
    const before = modeMarkingsKey(s);
    s.units.find((u) => u.id === id)!.dead = true;
    expect(unitBadges(s)).toEqual({});
    expect(modeMarkingsKey(s)).not.toBe(before);
    expect(modeHud(s, VS_AI)!.lines[0]).toBe('You escort the Pig (fallen)');
  });
});
