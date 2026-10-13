import { describe, expect, it } from 'vitest';
import { createGame, DEFAULT_SURRENDER, makeHexGrid, reduce, getLegalCommands, tossInitiative, vecKey } from '@fansong/engine';
import { unitCost } from '../src/cost.js';
import { warbandCost } from '../src/warband.js';
import { buildMatch, DEFAULT_BOARD, DEFAULT_MAP, defaultPigRounds, GOLDEN_PIG } from '../src/deploy.js';
import { listMaps } from '../src/mapRegistry.js';
import { supportedModes } from '../src/mapValidate.js';
import { PRESETS } from '../src/presets.js';

const board = DEFAULT_BOARD;

describe('buildMatch', () => {
  it('produces a config that createGame accepts and can start reducing', () => {
    const config = buildMatch(PRESETS['iron-wardens-medium']!, PRESETS['night-haunt-medium']!, {
      seed: 7,
      board,
    });
    const state = createGame(config);
    expect(state.units).toHaveLength(
      PRESETS['iron-wardens-medium']!.units.length + PRESETS['night-haunt-medium']!.units.length,
    );
    // No two units start stacked, and there is a legal opening move.
    expect(new Set(state.units.map((u) => vecKey(u.pos))).size).toBe(state.units.length);
    expect(getLegalCommands(state).length).toBeGreaterThan(0);
    // One reduce step keeps the game well-formed.
    const next = reduce(state, getLegalCommands(state)[0]!);
    expect(next.state.units).toHaveLength(state.units.length);
  });

  it('honours the requested initiative leader', () => {
    const config = buildMatch(PRESETS['iron-wardens-medium']!, PRESETS['night-haunt-medium']!, {
      seed: 1,
      board,
      initiativeLeader: 1,
    });
    expect(createGame(config).initiativeLeader).toBe(1);
  });

  it('tosses a coin for the first turn when nobody is named, the same way for the same seed', () => {
    const leader = (seed: number) =>
      createGame(buildMatch(PRESETS['iron-wardens-medium']!, PRESETS['night-haunt-medium']!, { seed, board })).initiativeLeader;
    const leaders = Array.from({ length: 40 }, (_, seed) => leader(seed));
    expect(leaders).toEqual(leaders.map((_, seed) => tossInitiative(seed)));
    expect(new Set(leaders)).toEqual(new Set([0, 1]));
    // Whoever wins the toss is the side to act.
    const state = createGame(buildMatch(PRESETS['iron-wardens-medium']!, PRESETS['night-haunt-medium']!, { seed: 40, board }));
    expect(state.active).toBe(state.initiativeLeader);
  });
});

describe('buildMatch: forced surrender', () => {
  const p0 = PRESETS['iron-wardens-medium']!;
  const p1 = PRESETS['ashfang-raiders-medium']!;
  const map = listMaps().find((m) => m.id === 'old-forest')!;

  it('turns the rule on in annihilation, each spec carrying its unit\'s cost', () => {
    for (const config of [buildMatch(p0, p1, { seed: 3 }), buildMatch(p0, p1, { seed: 3, map }), buildMatch(p0, p1, { seed: 3, mode: 'annihilation' })]) {
      expect(config.surrender).toEqual(DEFAULT_SURRENDER);
      expect(config.warbands[0].map((s) => s.points)).toEqual(p0.units.map(unitCost));
      expect(config.warbands[1].map((s) => s.points)).toEqual(p1.units.map(unitCost));
      expect(createGame(config).surrender).toEqual({ ...DEFAULT_SURRENDER, start: [warbandCost(p0), warbandCost(p1)] });
    }
  });

  it('leaves it off in every other mode', () => {
    for (const mode of supportedModes(map).filter((m) => m !== 'annihilation')) {
      const config = buildMatch(p0, p1, { seed: 3, map, mode });
      expect('surrender' in config).toBe(false);
      expect(config.warbands.flat().some((s) => 'points' in s)).toBe(false);
      expect('surrender' in createGame(config)).toBe(false);
    }
  });

  it('can be opted out of, which adds nothing to the config', () => {
    const off = buildMatch(p0, p1, { seed: 3, map, surrender: false });
    expect('surrender' in off).toBe(false);
    expect(off.warbands.flat().some((s) => 'points' in s)).toBe(false);
    const on = buildMatch(p0, p1, { seed: 3, map });
    delete on.surrender;
    for (const spec of on.warbands.flat()) delete spec.points;
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
  });
});

describe('buildMatch: extract the golden Pig', () => {
  const p0 = PRESETS['iron-wardens-medium']!;
  const p1 = PRESETS['ashfang-raiders-medium']!;
  const map = listMaps().find((m) => m.id === 'old-forest')!;

  it('adds the Pig last to the escort, leaving every other unit id as it was', () => {
    const plain = buildMatch(p0, p1, { seed: 3, map });
    const config = buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig' });
    expect(config.warbands[0]).toHaveLength(p0.units.length + 1);
    expect(config.warbands[1]).toHaveLength(p1.units.length);
    expect(config.warbands[0].map((s) => s.name)).toEqual([...plain.warbands[0].map((s) => s.name), GOLDEN_PIG.name]);
    const pig = config.warbands[0].at(-1)!;
    expect(pig).toMatchObject({ pig: true, quality: 2, combat: 3, slow: true, tough: true, look: 'Piglet', tint: '#ffd700' });
    expect(config.warbands.flat().filter((s) => s.pig)).toHaveLength(1);
    const state = createGame(config);
    expect(state.mode?.pig).toEqual({ unitId: `p0u${p0.units.length}`, escort: 0 });
    expect(new Set(state.units.map((u) => vecKey(u.pos))).size).toBe(state.units.length);
  });

  it('deploys the Pig in the middle of the back rank', () => {
    const config = buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig' });
    const board = makeHexGrid({ width: map.width, height: map.height, blocked: [] });
    const depth = (v: { x: number; y: number }) => Math.min(...map.deployZones[1].map((e) => board.distance(v, e)));
    const pig = config.warbands[0].at(-1)!;
    expect(depth(pig.pos)).toBe(Math.max(...map.deployZones[0].map(depth)));
    // On the flat board the escort's eight models fill rows 1–8 of its edge column.
    const flat = buildMatch(p0, p1, { seed: 3, mode: 'golden-pig' });
    expect(flat.warbands[0].at(-1)!.pos).toEqual({ x: 0, y: 4 });
    expect(new Set(flat.warbands[0].map((s) => vecKey(s.pos))).size).toBe(flat.warbands[0].length);
    expect(buildMatch(p0, p1, { seed: 3, mode: 'golden-pig', escort: 1 }).warbands[1].at(-1)!.pos).toEqual({ x: DEFAULT_BOARD.width - 1, y: 4 });
  });

  it('makes the defender’s deploy zone the goal, for either escort', () => {
    expect(buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig' }).objectives).toEqual({ extraction: map.deployZones[1] });
    const swapped = buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig', escort: 1 });
    expect(swapped.objectives).toEqual({ extraction: map.deployZones[0] });
    expect(swapped.warbands[0]).toHaveLength(p0.units.length);
    expect(swapped.warbands[1].at(-1)).toMatchObject({ name: GOLDEN_PIG.name, pig: true });
    expect(createGame(swapped).mode?.pig).toEqual({ unitId: `p1u${p1.units.length}`, escort: 1 });
  });

  it('plays on the flat default board too, aiming for the defender’s edge column', () => {
    const config = buildMatch(p0, p1, { seed: 3, mode: 'golden-pig' });
    expect(config.objectives?.extraction).toEqual(Array.from({ length: DEFAULT_BOARD.height }, (_, y) => ({ x: DEFAULT_BOARD.width - 1, y })));
    expect(createGame(config).mode?.pig?.escort).toBe(0);
  });

  it('sets the round limit from the walk to the goal unless one is given', () => {
    expect(defaultPigRounds(DEFAULT_MAP)).toBe(PIG_ROUNDS_DEFAULT_BOARD);
    expect(defaultPigRounds(DEFAULT_MAP, 1)).toBe(PIG_ROUNDS_DEFAULT_BOARD);
    expect(buildMatch(p0, p1, { seed: 3, mode: 'golden-pig' }).limits).toEqual({ roundLimit: PIG_ROUNDS_DEFAULT_BOARD });
    expect(buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig' }).limits).toEqual({ roundLimit: defaultPigRounds(map) });
    for (const m of listMaps()) {
      expect(defaultPigRounds(m)).toBeGreaterThanOrEqual(5);
      expect(defaultPigRounds(m)).toBeLessThanOrEqual(50);
    }
    expect(buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig', limits: { roundLimit: 9 } }).limits).toEqual({ roundLimit: 9 });
    expect(buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig', limits: { roundLimit: null } }).limits).toEqual({ roundLimit: null });
    // Other modes get no limit of their own from here.
    expect(buildMatch(p0, p1, { seed: 3, map }).limits).toBeUndefined();
  });

  it('is hosted by every built-in map, and ignores the escort in other modes', () => {
    for (const m of listMaps()) expect(supportedModes(m)).toContain('golden-pig');
    expect(buildMatch(p0, p1, { seed: 3, map, escort: 1 })).toEqual(buildMatch(p0, p1, { seed: 3, map }));
  });
});

/** ceil(10 hexes / 3 per Move) + 4 on the flat 12×10 board. */
const PIG_ROUNDS_DEFAULT_BOARD = 8;
